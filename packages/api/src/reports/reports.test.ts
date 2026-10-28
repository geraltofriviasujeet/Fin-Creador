import { describe, expect, it } from "vitest"
import { CSV_BOM, dashboardRange, monthStart } from "@fin-creador/domain"
import type { UserClient } from "../income/client"
import { EXPORT_HEADER, EXPORT_MESSAGES, EXPORT_ROW_CAP, exportTransactionsCsv } from "./export"
import { loadCashFlow, loadNetWorthTrend } from "./load"
import { readReportsParams } from "./params"

const TODAY = "2026-10-28"
const BANK = "a1000000-0000-4000-8000-000000000001"
const CASH = "a1000000-0000-4000-8000-000000000002"
const FOOD = "c1000000-0000-4000-8000-000000000001"

type Rows = Record<string, Record<string, unknown>[]>
type Rpc = { fn: string; args: Record<string, unknown> }

/** Answers selects from `rows` (eq / in / is / gt / gte / lte / or / range) and RPCs from `rpc`. */
function fakeClient(rows: Rows, rpc: (call: Rpc) => unknown = () => [], { signedIn = true } = {}) {
  const calls: Rpc[] = []
  const reads: { table: string; range?: [number, number] }[] = []
  const from = (table: string) => {
    let result = [...(rows[table] ?? [])]
    const read: { table: string; range?: [number, number] } = { table }
    reads.push(read)
    const builder = {
      select: () => builder,
      eq: (c: string, v: unknown) => ((result = result.filter((r) => r[c] === v)), builder),
      in: (c: string, v: unknown[]) => ((result = result.filter((r) => v.includes(r[c]))), builder),
      is: (c: string, v: unknown) => ((result = result.filter((r) => (r[c] ?? null) === v)), builder),
      gt: (c: string, v: number) => ((result = result.filter((r) => (r[c] as number) > v)), builder),
      gte: (c: string, v: string) => ((result = result.filter((r) => (r[c] as string) >= v)), builder),
      lte: (c: string, v: string) => ((result = result.filter((r) => (r[c] as string) <= v)), builder),
      or: (expr: string) => {
        const clauses = expr.split(",").map((c) => c.split(".eq."))
        result = result.filter((r) => clauses.some(([col, v]) => r[col!] === v))
        return builder
      },
      order: () => builder,
      range: (a: number, b: number) => ((read.range = [a, b]), (result = result.slice(a, b + 1)), builder),
      maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(resolve),
    }
    return builder
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "user-1" } : null } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "user_local_today") return { data: TODAY, error: null }
      calls.push({ fn, args })
      return { data: rpc({ fn, args }), error: null }
    },
    from,
  }
  return { client: client as unknown as UserClient, calls, reads }
}

const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
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
  profiles: [{ id: "user-1", currency: "INR", time_zone: "Asia/Kolkata" }],
  accounts: [
    { id: BANK, name: "=HDFC Savings", kind: "bank", currency: "INR" },
    { id: CASH, name: "Cash in hand", kind: "cash", currency: "INR" },
  ],
  categories: [{ id: FOOD, name: "Food & dining" }],
}

const parse = (csv: string) => csv.slice(CSV_BOM.length).split("\r\n").filter(Boolean)

describe("exportTransactionsCsv", () => {
  it("header, ISO dates, decimal amounts, guarded text cells; voided entries left out by default", async () => {
    const rows = {
      ...BASE,
      transactions: [
        entry("t1", { note: '=HYPERLINK("http://example.test","x")' }),
        entry("t2", { type: "transfer", amount_minor: 5_00, account_id: BANK, counter_account_id: CASH, category_id: null, payment_mode: null, note: "-ATM" }),
        entry("t3", { voided_at: "2026-10-02T00:00:00Z" }),
      ],
    }
    const r = await exportTransactionsCsv(fakeClient(rows).client, { from: "2026-10-01", to: "2026-10-31" })
    if (!r.ok) throw new Error(r.message)
    const lines = parse(r.csv)
    expect(r.csv.startsWith(CSV_BOM)).toBe(true)
    expect(lines[0]).toBe(EXPORT_HEADER.join(","))
    expect(lines.slice(1)).toEqual([
      `2026-10-01,Expense,1250.50,INR,'=HDFC Savings,,Food & dining,UPI,"'=HYPERLINK(""http://example.test"",""x"")",`,
      "2026-10-01,Transfer,5.00,INR,'=HDFC Savings,Cash in hand,,,'-ATM,",
    ])
    expect([r.filename, r.rowCount]).toEqual(["fincreador-transactions-2026-10-01-to-2026-10-31.csv", 2])
  })

  it("with voided entries: marked Yes, and an edit's old version never shows", async () => {
    const rows = {
      ...BASE,
      transactions: [
        entry("old", { voided_at: "2026-10-02T00:00:00Z" }),
        entry("new", { replaces_id: "old", amount_minor: 99_00 }),
        entry("void", { voided_at: "2026-10-03T00:00:00Z", amount_minor: 7_00 }),
      ],
    }
    const r = await exportTransactionsCsv(fakeClient(rows).client, { from: "2026-10-01", to: "2026-10-31", voided: "1" })
    if (!r.ok) throw new Error(r.message)
    expect(parse(r.csv).slice(1).map((l) => [l.split(",")[2], l.split(",").at(-1)])).toEqual([
      ["99.00", ""],
      ["7.00", "Yes"],
    ])
  })

  it("by account (either side of a transfer) or by category", async () => {
    const rows = { ...BASE, transactions: [entry("t1"), entry("t2", { type: "transfer", account_id: BANK, counter_account_id: CASH, category_id: null }), entry("t3", { account_id: "other" })] }
    const byCash = await exportTransactionsCsv(fakeClient(rows).client, { from: "2026-10-01", to: "2026-10-31", account: CASH })
    const byFood = await exportTransactionsCsv(fakeClient(rows).client, { from: "2026-10-01", to: "2026-10-31", category: FOOD })
    expect([byCash.ok && byCash.rowCount, byFood.ok && byFood.rowCount]).toEqual([1, 2])
  })

  it("paged reads of 1,000; more than the cap is refused with 413", async () => {
    const many = Array.from({ length: EXPORT_ROW_CAP + 1 }, (_, i) => entry(`t${i}`))
    const { client, reads } = fakeClient({ ...BASE, transactions: many })
    const r = await exportTransactionsCsv(client, { from: "2026-10-01", to: "2026-10-31" })
    expect(r).toEqual({ ok: false, status: 413, message: EXPORT_MESSAGES.tooMany })
    expect(reads.filter((x) => x.table === "transactions").map((x) => x.range)).toHaveLength(11)
    const exact = await exportTransactionsCsv(fakeClient({ ...BASE, transactions: many.slice(1) }).client, { from: "2026-10-01", to: "2026-10-31" })
    expect(exact.ok && exact.rowCount).toBe(EXPORT_ROW_CAP)
  })

  it("refuses bad parameters (400) and a signed-out caller (401)", async () => {
    const { client } = fakeClient(BASE)
    for (const params of [
      {},
      { from: "2026-10-31", to: "2026-10-01" },
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2000-01-01", to: "2026-10-01" },
      { from: "2026-10-01", to: "2026-10-31", account: "x),category_id.eq.y" },
      { from: "2026-10-01", to: "2026-10-31", voided: "yes" },
    ]) {
      expect(await exportTransactionsCsv(client, params)).toEqual({ ok: false, status: 400, message: EXPORT_MESSAGES.invalid })
    }
    expect(await exportTransactionsCsv(fakeClient(BASE, undefined, { signedIn: false }).client, { from: "2026-10-01", to: "2026-10-31" })).toEqual({
      ok: false,
      status: 401,
      message: EXPORT_MESSAGES.signedOut,
    })
  })
})

describe("readReportsParams", () => {
  const read = (q: string) => readReportsParams(new URLSearchParams(q), TODAY)
  it("12 months ending this month by default; presets; custom months clamped to 24 and to this month", () => {
    expect([read("").from, read("").to, read("").months.length, read("").preset]).toEqual(["2025-11-01", "2026-10-01", 12, 12])
    expect(read("months=3").months).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"])
    expect(read("months=7").preset).toBe(12)
    expect([read("from=2026-01&to=2026-03").months.length, read("from=2026-01&to=2026-03").preset]).toEqual([3, null])
    expect(read("from=2020-01&to=2030-12")).toMatchObject({ from: "2024-11-01", to: "2026-10-01" })
    expect(read("from=2026-05&to=2026-02")).toMatchObject({ from: "2026-02-01", to: "2026-05-01" })
  })
})

describe("loadCashFlow", () => {
  it("one dashboard_breakdown per whole month (the Overview's month range); profile currency only", async () => {
    const { client, calls } = fakeClient(BASE, ({ args }) =>
      args.p_from === "2026-10-01"
        ? [
            { kind: "day", currency: "INR", bucket_start: "2026-10-01", category_id: null, income_minor: 50_000_00, expense_minor: 2_000_00 },
            { kind: "day", currency: "INR", bucket_start: "2026-10-05", category_id: null, income_minor: 0, expense_minor: 1_000_00 },
            { kind: "category", currency: "INR", bucket_start: null, category_id: FOOD, income_minor: 0, expense_minor: 3_000_00 },
            { kind: "day", currency: "USD", bucket_start: "2026-10-01", category_id: null, income_minor: 10_00, expense_minor: 0 },
          ]
        : [],
    )
    const r = await loadCashFlow(client, ["2026-09-01", "2026-10-01"])
    if (!r.ok) throw new Error("load failed")
    const overviewMonth = dashboardRange("month", TODAY)
    expect(calls.map((c) => c.args)).toEqual([
      { p_from: "2026-09-01", p_to: "2026-09-30" },
      { p_from: overviewMonth.start, p_to: overviewMonth.end },
    ])
    const oct = r.data.report.rows[1]!
    expect([oct.incomeMinor, oct.expenseMinor, oct.soFar, oct.topCategory]).toEqual([50_000_00, 3_000_00, true, { categoryId: FOOD, expenseMinor: 3_000_00 }])
    expect(r.data.otherCurrencies).toEqual(["USD"])
  })
})

describe("loadNetWorthTrend", () => {
  it("one account_balances_at call for the month-ends and today; deposits and dues by date", async () => {
    const rows: Rows = {
      ...BASE,
      account_balances: [],
      loans: [],
      due_payments: [],
      due_items: [],
      investments: [],
      fixed_deposits: [{ bank: "SBI", label: null, principal_minor: 1_00_000_00, rate_bps: 0, compounding: "quarterly", start_date: "2026-09-15", maturity_date: "2027-09-15", archived_at: null }],
      statutory_dues: [{ id: "d1", due_type: "fine", description: null, currency: "INR", amount_minor: 1_000_00, due_date: "2026-11-01", archived_at: null, created_at: "2026-09-30T19:00:00Z" }],
    }
    const { client, calls } = fakeClient(rows, ({ fn, args }) =>
      fn === "account_balances_at"
        ? (args.p_dates as string[]).filter((d) => d >= "2026-09-30").map((d) => ({ as_of: d, account_id: BANK, balance_minor: 10_000_00 }))
        : [],
    )
    const r = await loadNetWorthTrend(client, monthStart(TODAY, -2))
    if (!r.ok) throw new Error("load failed")
    expect(calls.filter((c) => c.fn === "account_balances_at").map((c) => c.args.p_dates)).toEqual([["2026-08-31", "2026-09-30", TODAY]])
    // 30 Sep 19:00 UTC is 1 Oct in India: the fine counts only today.
    expect(r.data.points.map((p) => [p.date, p.worth.totalMinor])).toEqual([
      ["2026-09-30", 1_10_000_00],
      [TODAY, 1_09_000_00],
    ])
    expect(r.data.current?.totalMinor).not.toBeUndefined()
  })
})
