import { describe, expect, it } from "vitest"
import { CSV_BOM } from "@fin-creador/domain"
import type { UserClient } from "../income/client"
import { EXPORT_HEADER, EXPORT_MAX_DAYS, EXPORT_MESSAGES, EXPORT_ROW_CAP, exportParamsSchema, exportTransactionsCsv } from "./export"

// QA regression tests for the Sprint 8c CSV export: isolation, injection, row cap and paging,
// parameter validation, date-range abuse. Expected values are written by hand, not taken from the
// code under test.

const ME = "user-1"
const OTHER = "user-2"
const BANK = "a1000000-0000-4000-8000-000000000001"
const CASH = "a1000000-0000-4000-8000-000000000002"
const THEIRS = "a2000000-0000-4000-8000-000000000001"
const FOOD = "c1000000-0000-4000-8000-000000000001"
const THEIR_CAT = "c2000000-0000-4000-8000-000000000001"

type Rows = Record<string, Record<string, unknown>[]>

/** Answers selects like PostgREST with row level security: only rows whose user_id is the signed-in user. */
function fakeClient(rows: Rows, { signedIn = true } = {}) {
  const reads: { table: string; range?: [number, number] }[] = []
  const from = (table: string) => {
    let result = (rows[table] ?? []).filter((r) => r.user_id === ME)
    const read: { table: string; range?: [number, number] } = { table }
    reads.push(read)
    const builder = {
      select: () => builder,
      eq: (c: string, v: unknown) => ((result = result.filter((r) => r[c] === v)), builder),
      in: (c: string, v: unknown[]) => ((result = result.filter((r) => v.includes(r[c]))), builder),
      is: (c: string, v: unknown) => ((result = result.filter((r) => (r[c] ?? null) === v)), builder),
      gte: (c: string, v: string) => ((result = result.filter((r) => (r[c] as string) >= v)), builder),
      lte: (c: string, v: string) => ((result = result.filter((r) => (r[c] as string) <= v)), builder),
      or: (expr: string) => {
        const clauses = expr.split(",").map((c) => c.split(".eq."))
        result = result.filter((r) => clauses.some(([col, v]) => r[col!] === v))
        return builder
      },
      order: () => builder,
      range: (a: number, b: number) => ((read.range = [a, b]), (result = result.slice(a, b + 1)), builder),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(resolve),
    }
    return builder
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: ME } : null } }) },
    rpc: async (fn: string) => ({ data: fn === "user_local_today" ? "2026-10-28" : null, error: null }),
    from,
  }
  return { client: client as unknown as UserClient, reads }
}

const tx = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: ME,
  type: "expense",
  amount_minor: 1_250_50,
  currency: "INR",
  occurred_on: "2026-10-01",
  account_id: BANK,
  counter_account_id: null,
  category_id: FOOD,
  note: null,
  payment_mode: "upi",
  voided_at: null,
  replaces_id: null,
  ...extra,
})

const BASE: Rows = {
  profiles: [{ id: ME, currency: "INR", time_zone: "Asia/Kolkata" }],
  accounts: [
    { id: BANK, user_id: ME, name: "HDFC", kind: "bank" },
    { id: CASH, user_id: ME, name: "Cash in hand", kind: "cash" },
    { id: THEIRS, user_id: OTHER, name: "Other person's secret bank", kind: "bank" },
  ],
  categories: [
    { id: FOOD, user_id: ME, name: "Food" },
    { id: THEIR_CAT, user_id: OTHER, name: "Other person's category" },
  ],
}

const RANGE = { from: "2026-10-01", to: "2026-10-31" }

/** RFC 4180 reader (quoted fields, doubled quotes, CRLF). */
function parseCsv(file: string): string[][] {
  expect(file.startsWith(CSV_BOM)).toBe(true)
  const text = file.slice(CSV_BOM.length)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") {
      row.push(cell)
      cell = ""
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
      i++
    } else cell += ch
  }
  return rows
}

const run = async (rows: Rows, params: Record<string, string | undefined> = RANGE) => exportTransactionsCsv(fakeClient(rows).client, params)

describe("export isolation", () => {
  const rows: Rows = {
    ...BASE,
    transactions: [
      tx("mine-1", { note: "mine" }),
      tx("mine-2", { type: "transfer", counter_account_id: CASH, category_id: null }),
      tx("theirs-1", { user_id: OTHER, account_id: THEIRS, category_id: THEIR_CAT, note: "THEIR-SECRET" }),
      tx("theirs-2", { user_id: OTHER, type: "transfer", account_id: THEIRS, counter_account_id: THEIRS, category_id: null, note: "THEIR-SECRET-2" }),
    ],
  }
  it("no filter, their account id, their category id, or both: none of the other user's rows or names", async () => {
    const cases: [Record<string, string>, number][] = [
      [RANGE, 2],
      [{ ...RANGE, account: THEIRS }, 0],
      [{ ...RANGE, category: THEIR_CAT }, 0],
      [{ ...RANGE, account: THEIRS, category: THEIR_CAT }, 0],
      [{ ...RANGE, voided: "1" }, 2],
    ]
    for (const [params, count] of cases) {
      const r = await run(rows, params)
      if (!r.ok) throw new Error(r.message)
      expect(r.rowCount, JSON.stringify(params)).toBe(count)
      expect(r.csv).not.toMatch(/THEIR|Other person/)
    }
  })
  it("a row that points at an account or category the caller cannot read shows blank names, never the name", async () => {
    const leaky: Rows = { ...BASE, transactions: [tx("odd", { account_id: THEIRS, counter_account_id: THEIRS, category_id: THEIR_CAT })] }
    const r = await run(leaky)
    if (!r.ok) throw new Error(r.message)
    expect(parseCsv(r.csv)[1]!.slice(4, 7)).toEqual(["", "", ""])
    expect(r.csv).not.toContain("Other person")
  })
  it("a signed-out caller gets 401 and no data", async () => {
    const r = await exportTransactionsCsv(fakeClient(rows, { signedIn: false }).client, RANGE)
    expect(r).toEqual({ ok: false, status: 401, message: EXPORT_MESSAGES.signedOut })
  })
})

describe("export CSV injection", () => {
  const STARTS = ["=", "+", "-", "@", "\t", "\r"]
  it("every text column is guarded for every formula start; quotes, commas and newlines survive", async () => {
    for (const s of STARTS) {
      const rows: Rows = {
        ...BASE,
        accounts: [
          { id: BANK, user_id: ME, name: `${s}acct,"q"`, kind: "bank" },
          { id: CASH, user_id: ME, name: `${s}to\nacct`, kind: "cash" },
        ],
        categories: [{ id: FOOD, user_id: ME, name: `${s}cat` }],
        transactions: [tx("t", { type: "transfer", counter_account_id: CASH, note: `${s}note, "x"\r\nline2` })],
      }
      const r = await run(rows)
      if (!r.ok) throw new Error(r.message)
      const cells = parseCsv(r.csv)[1]!
      expect(cells[4], `Account ${JSON.stringify(s)}`).toBe(`'${s}acct,"q"`)
      expect(cells[5], `To account ${JSON.stringify(s)}`).toBe(`'${s}to\nacct`)
      expect(cells[6], `Category ${JSON.stringify(s)}`).toBe(`'${s}cat`)
      expect(cells[8], `Note ${JSON.stringify(s)}`).toBe(`'${s}note, "x"\r\nline2`)
      expect(cells).toHaveLength(EXPORT_HEADER.length)
    }
  })
  it("Payment mode is guarded as text too, and no label is a formula start", async () => {
    for (const mode of ["upi", "cash", "card", "bank_transfer", "cheque", "other", null, "=weird"]) {
      const r = await run({ ...BASE, transactions: [tx("t", { payment_mode: mode })] })
      if (!r.ok) throw new Error(r.message)
      expect(parseCsv(r.csv)[1]![7]).not.toMatch(/^[=+\-@\t\r]/)
    }
  })
  it("generated cells are never guarded: date, numeric amount (incl. small and zero-padded), currency, type, voided", async () => {
    const rows: Rows = {
      ...BASE,
      transactions: [tx("a", { amount_minor: 5 }), tx("b", { amount_minor: 100 }), tx("c", { amount_minor: 1_00_00_000_00 }), tx("v", { voided_at: "2026-10-02T00:00:00Z", type: "income" })],
    }
    const r = await run(rows, { ...RANGE, voided: "1" })
    if (!r.ok) throw new Error(r.message)
    const body = parseCsv(r.csv).slice(1)
    expect(body.map((c) => c[2])).toEqual(["0.05", "1.00", "10000000.00", "1250.50"])
    for (const c of body) {
      expect(c[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(c[2]).toMatch(/^\d+\.\d{2}$/)
      expect([c[3], c[1]]).toEqual(["INR", expect.stringMatching(/^(Expense|Income|Transfer)$/)])
      expect(c[9]).toMatch(/^(Yes)?$/)
      for (const i of [0, 1, 2, 3, 9]) expect(c[i]!.startsWith("'")).toBe(false)
    }
    expect(body[3]![9]).toBe("Yes")
  })
})

describe("export row cap and paging", () => {
  const many = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})) => Array.from({ length: n }, (_, i) => tx(`t${i}`, extra(i)))
  const txReads = (reads: { table: string; range?: [number, number] }[]) => reads.filter((r) => r.table === "transactions" && r.range).map((r) => r.range)

  it.each([
    [0, 1],
    [1, 1],
    [999, 1],
    [1000, 2],
    [1001, 2],
    [2000, 3],
  ])("%i rows: all returned, %i read(s) of 1,000", async (n, reads) => {
    const { client, reads: log } = fakeClient({ ...BASE, transactions: many(n) })
    const r = await exportTransactionsCsv(client, RANGE)
    if (!r.ok) throw new Error(r.message)
    expect(r.rowCount).toBe(n)
    expect(parseCsv(r.csv)).toHaveLength(n + 1)
    expect(txReads(log)).toHaveLength(reads)
    expect(txReads(log)[0]).toEqual([0, 999])
  })
  it("no row is duplicated or dropped at page boundaries", async () => {
    const r = await run({ ...BASE, transactions: many(2500, (i) => ({ amount_minor: i + 1 })) })
    if (!r.ok) throw new Error(r.message)
    expect(parseCsv(r.csv).slice(1).map((c) => c[2])).toEqual(Array.from({ length: 2500 }, (_, i) => `${Math.floor((i + 1) / 100)}.${String((i + 1) % 100).padStart(2, "0")}`))
  })
  it("exactly 10,000 rows succeed; 10,001 is 413; 20,000 stops early without reading everything", async () => {
    const ok = await run({ ...BASE, transactions: many(EXPORT_ROW_CAP) })
    expect(ok.ok && ok.rowCount).toBe(10_000)
    expect(await run({ ...BASE, transactions: many(EXPORT_ROW_CAP + 1) })).toEqual({ ok: false, status: 413, message: EXPORT_MESSAGES.tooMany })
    const { client, reads } = fakeClient({ ...BASE, transactions: many(20_000) })
    expect((await exportTransactionsCsv(client, RANGE)).ok).toBe(false)
    expect(txReads(reads)).toHaveLength(11)
  })
  it("the cap counts only the caller's rows (RLS), not the other user's", async () => {
    const mixed = [...many(EXPORT_ROW_CAP), ...many(500).map((t) => ({ ...t, id: `o${t.id}`, user_id: OTHER }))]
    const r = await run({ ...BASE, transactions: mixed })
    expect(r.ok && r.rowCount).toBe(10_000)
  })
  it("edit-replaced filter with voided included works across pages (old version on page 1, replacement on page 2)", async () => {
    const rows = [
      tx("old", { voided_at: "2026-10-02T00:00:00Z", amount_minor: 98_765 }),
      ...many(1500, (i) => ({ amount_minor: 100 + i })).map((t) => ({ ...t, id: `fill${t.id}` })),
      tx("new", { replaces_id: "old", amount_minor: 222 }),
      tx("plain-void", { voided_at: "2026-10-03T00:00:00Z", amount_minor: 333 }),
    ]
    const r = await run({ ...BASE, transactions: rows }, { ...RANGE, voided: "1" })
    if (!r.ok) throw new Error(r.message)
    const amounts = parseCsv(r.csv).slice(1).map((c) => c[2])
    expect(amounts).not.toContain("987.65")
    expect(amounts.slice(-2)).toEqual(["2.22", "3.33"])
    expect(r.rowCount).toBe(1500 + 2)
  })
  it("more than 200 voided rows: the replaced lookup is chunked and still hides every replaced old version", async () => {
    const olds = Array.from({ length: 450 }, (_, i) => tx(`old${i}`, { voided_at: "2026-10-02T00:00:00Z", amount_minor: 1 }))
    const news = olds.map((o, i) => tx(`new${i}`, { replaces_id: o.id, amount_minor: 2 }))
    const r = await run({ ...BASE, transactions: [...olds, ...news] }, { ...RANGE, voided: "1" })
    if (!r.ok) throw new Error(r.message)
    expect(r.rowCount).toBe(450)
    expect(parseCsv(r.csv).slice(1).every((c) => c[2] === "0.02" && c[9] === "")).toBe(true)
  })
  it("without voided entries, a replaced old version and voided rows are absent", async () => {
    const r = await run({ ...BASE, transactions: [tx("old", { voided_at: "2026-10-02T00:00:00Z" }), tx("new", { replaces_id: "old" })] })
    expect(r.ok && r.rowCount).toBe(1)
  })
  it("date range is inclusive at both ends", async () => {
    const rows = [tx("a", { occurred_on: "2026-09-30" }), tx("b", { occurred_on: "2026-10-01" }), tx("c", { occurred_on: "2026-10-31" }), tx("d", { occurred_on: "2026-11-01" })]
    const r = await run({ ...BASE, transactions: rows })
    expect(r.ok && r.rowCount).toBe(2)
  })
})

describe("export parameter validation", () => {
  const bad = async (params: unknown) => expect(await exportTransactionsCsv(fakeClient(BASE).client, params as Record<string, string>)).toEqual({ ok: false, status: 400, message: EXPORT_MESSAGES.invalid })
  const good = async (params: Record<string, string>) => expect((await exportTransactionsCsv(fakeClient(BASE).client, params)).ok).toBe(true)

  it("missing or invalid dates are 400", async () => {
    for (const p of [
      {},
      { from: "2026-10-01" },
      { to: "2026-10-31" },
      { from: "", to: "" },
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-02-01", to: "2026-02-29" },
      { from: "2026-13-01", to: "2026-13-02" },
      { from: "2026-00-10", to: "2026-10-01" },
      { from: "2026-10-00", to: "2026-10-01" },
      { from: "26-10-01", to: "2026-10-31" },
      { from: "2026/10/01", to: "2026-10-31" },
      { from: "01-10-2026", to: "2026-10-31" },
      { from: "2026-10-1", to: "2026-10-31" },
      { from: "2026-10-01T00:00:00Z", to: "2026-10-31" },
      { from: " 2026-10-01", to: "2026-10-31" },
      { from: "2026-10-01\n", to: "2026-10-31" },
      { from: "20261001", to: "20261031" },
      { from: "abc", to: "def" },
      { from: "２０２６-10-01", to: "2026-10-31" },
    ])
      await bad(p)
  })
  it("reversed range is 400; same day is fine", async () => {
    await bad({ from: "2026-10-31", to: "2026-10-01" })
    await bad({ from: "2026-01-02", to: "2026-01-01" })
    await good({ from: "2026-10-01", to: "2026-10-01" })
  })
  it("non-string and array parameters are 400", async () => {
    await bad({ from: ["2026-10-01", "2026-10-02"], to: "2026-10-31" })
    await bad({ ...RANGE, account: [BANK, CASH] })
    await bad({ ...RANGE, category: [FOOD] })
    await bad({ ...RANGE, voided: ["0", "1"] })
    await bad({ from: 20261001, to: "2026-10-31" })
    await bad({ ...RANGE, account: 5 })
    await bad({ ...RANGE, voided: true })
  })
  it("malformed UUIDs are 400, including filter-injection attempts", async () => {
    for (const id of [
      "not-a-uuid",
      "a1000000-0000-4000-8000-00000000000",
      "a1000000-0000-4000-8000-0000000000011",
      "a1000000000040008000000000000001",
      "g1000000-0000-4000-8000-000000000001",
      `${BANK},category_id.eq.${FOOD}`,
      `${BANK}),user_id.neq.x`,
      `${BANK}\n`.replace("\n", ",id.eq.x"),
      "*",
      "null",
      "%",
      "{" + BANK + "}",
    ]) {
      await bad({ ...RANGE, account: id })
      await bad({ ...RANGE, category: id })
    }
  })
  it("valid UUIDs (any case, surrounding spaces trimmed) and empty filters are accepted", async () => {
    await good({ ...RANGE, account: BANK.toUpperCase() })
    await good({ ...RANGE, account: `  ${BANK}  `, category: FOOD })
    await good({ ...RANGE, account: "", category: "   " })
    expect(exportParamsSchema.parse({ ...RANGE, account: "", category: " " })).toMatchObject({ account: null, category: null })
  })
  it("voided accepts only 0 or 1", async () => {
    for (const v of ["yes", "true", "false", "2", "-1", "01", "", " 1", "1 ", "on", "ONE"]) await bad({ ...RANGE, voided: v })
    for (const v of ["0", "1"]) await good({ ...RANGE, voided: v })
    expect([exportParamsSchema.parse({ ...RANGE }).voided, exportParamsSchema.parse({ ...RANGE, voided: "0" }).voided, exportParamsSchema.parse({ ...RANGE, voided: "1" }).voided]).toEqual([false, false, true])
  })
  it("unknown extra parameters are ignored (stripped), not forwarded to the query", async () => {
    const parsed = exportParamsSchema.parse({ ...RANGE, user_id: "x", select: "*", limit: "1" })
    expect(Object.keys(parsed).sort()).toEqual(["account", "category", "from", "to", "voided"])
    await good({ ...RANGE, user_id: "x", limit: "1", foo: "bar" })
  })
})

describe("export date-range abuse", () => {
  const spanDays = (days: number) => {
    const from = "2000-01-01"
    return { from, to: new Date(Date.parse(from) + days * 86_400_000).toISOString().slice(0, 10) }
  }
  const status = async (p: Record<string, string>) => {
    const r = await exportTransactionsCsv(fakeClient(BASE).client, p)
    return r.ok ? 200 : r.status
  }
  it("a span of 3,659 days is accepted; 3,660 and more are refused", async () => {
    expect(EXPORT_MAX_DAYS).toBe(3660)
    expect(await status(spanDays(3659))).toBe(200)
    expect(await status(spanDays(3660))).toBe(400)
    expect(await status(spanDays(3661))).toBe(400)
    expect(await status(spanDays(36_600))).toBe(400)
  })
  it("ten calendar years inclusive is 3,653 or 3,654 days apart and accepted; eleven years is refused", async () => {
    expect(await status({ from: "2016-11-01", to: "2026-10-31" })).toBe(200)
    expect(await status({ from: "2015-10-28", to: "2026-10-28" })).toBe(400)
  })
  it("far-past and far-future dates: valid ones with a short span are accepted (nothing to export), absurd spans refused", async () => {
    expect(await status({ from: "0001-01-01", to: "0001-12-31" })).toBe(200)
    expect(await status({ from: "9999-01-01", to: "9999-12-31" })).toBe(200)
    expect(await status({ from: "0000-01-01", to: "0000-01-02" })).toBe(200)
    expect(await status({ from: "0001-01-01", to: "9999-12-31" })).toBe(400)
    expect(await status({ from: "1900-01-01", to: "2999-12-31" })).toBe(400)
  })
  it("leap-day boundaries: 29 Feb of a leap year is valid, of a non-leap or century year is not", async () => {
    expect(await status({ from: "2028-02-29", to: "2028-02-29" })).toBe(200)
    expect(await status({ from: "2000-02-29", to: "2000-03-01" })).toBe(200)
    expect(await status({ from: "2026-02-29", to: "2026-03-01" })).toBe(400)
    expect(await status({ from: "1900-02-29", to: "1900-03-01" })).toBe(400)
    expect(await status({ from: "2100-02-29", to: "2100-03-01" })).toBe(400)
    // Ten years from 2024-02-28 to 2034-02-28 is 3,653 days (leap days 2024, 2028, 2032): accepted.
    expect(await status({ from: "2024-02-28", to: "2034-02-28" })).toBe(200)
    // Hand-computed: 2024-02-28 + 3,659 days = 2034-03-06 (last accepted), + 3,660 = 2034-03-07.
    expect(await status({ from: "2024-02-28", to: "2034-03-06" })).toBe(200)
    expect(await status({ from: "2024-02-28", to: "2034-03-07" })).toBe(400)
  })
  it("a leap-day entry is exported and the day after the range is not", async () => {
    const rows = { ...BASE, transactions: [tx("leap", { occurred_on: "2028-02-29" }), tx("after", { occurred_on: "2028-03-01" })] }
    const r = await run(rows, { from: "2028-02-28", to: "2028-02-29" })
    expect(r.ok && r.rowCount).toBe(1)
    expect(r.ok && r.filename).toBe("fincreador-transactions-2028-02-28-to-2028-02-29.csv")
  })
})
