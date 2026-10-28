import { describe, expect, it } from "vitest"
import { netWorth } from "@fin-creador/domain"
import type { UserClient } from "../income/client"
import { loadNetWorthData } from "./load"

const TODAY = "2026-10-28"

/** Answers selects from `rows` (eq / in / is / gt filters); `failing` tables answer with an error. */
function fakeClient(rows: Record<string, Record<string, unknown>[]>, failing: string[] = []) {
  const reads: string[] = []
  const from = (table: string) => {
    reads.push(table)
    let result = [...(rows[table] ?? [])]
    const builder = {
      select: () => builder,
      eq: (c: string, v: unknown) => ((result = result.filter((r) => r[c] === v)), builder),
      in: (c: string, v: unknown[]) => ((result = result.filter((r) => v.includes(r[c]))), builder),
      is: (c: string, v: unknown) => ((result = result.filter((r) => (r[c] ?? null) === v)), builder),
      gt: (c: string, v: number) => ((result = result.filter((r) => (r[c] as number) > v)), builder),
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(failing.includes(table) ? { data: null, error: { code: "500", message: "down" } } : { data: result, error: null }).then(resolve),
    }
    return builder
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async (fn: string) => (fn === "user_local_today" ? { data: TODAY, error: null } : { data: null, error: { code: "42883", message: "no" } }),
    from,
  }
  return { client: client as unknown as UserClient, reads }
}

const account = (id: string, kind: string, opening: number, extra: Record<string, unknown> = {}) => ({ id, kind, name: id, currency: "INR", opening_balance_minor: opening, archived_at: null, ...extra })

const ROWS = {
  profiles: [{ id: "user-1", currency: "INR", time_zone: "Asia/Kolkata" }],
  accounts: [
    account("bank", "bank", 1_00_000_00),
    account("loan", "loan", -5_00_000_00),
    account("emi", "loan", -12_000_00),
    account("card", "card", 0),
    account("old card", "card", -999_00, { archived_at: "2026-10-01T00:00:00Z" }),
  ],
  // Posted sums: 10,000 spent from the bank, 8,000 of purchases on the card.
  account_balances: [
    { account_id: "bank", inflow_minor: 0, outflow_minor: 10_000_00 },
    { account_id: "card", inflow_minor: 0, outflow_minor: 8_000_00 },
  ],
  loans: [
    { id: "L1", account_id: "loan", moratorium_interest: "capitalise", capitalised_minor: 20_000_00, archived_at: null },
    { id: "L2", account_id: "emi", moratorium_interest: null, capitalised_minor: 0, archived_at: null },
  ],
  // An unpaid EMI and an unpaid card bill for the whole card balance: neither is read or subtracted.
  due_items: [
    { id: "emi-1", kind: "loan_emi", loan_id: "L2", status: "pending", amount_due_minor: 4_000_00 },
    { id: "bill-1", kind: "card_bill", loan_id: null, status: "pending", amount_due_minor: 8_000_00 },
  ],
  due_payments: [],
  investments: [],
  fixed_deposits: [],
  statutory_dues: [],
}

describe("loadNetWorthData", () => {
  it("one read of account_balances; unpaid EMIs and card bills are not subtracted again", async () => {
    const { client, reads } = fakeClient(ROWS)
    const load = await loadNetWorthData(client)
    if (!load.ok) throw new Error("load failed")
    expect(reads.filter((t) => t === "account_balances")).toHaveLength(1)
    const r = netWorth(load.data)
    // 90,000 − (5,00,000 + 20,000 pending + 12,000) − 8,000
    expect(r.totalMinor).toBe(90_000_00 - 5_32_000_00 - 8_000_00)
    expect(r.lines.map((l) => [l.key, l.amountMinor])).toEqual([
      ["available", 90_000_00],
      ["loans", 5_32_000_00],
      ["cards", 8_000_00],
    ])
    expect(load.timeZone).toBe("Asia/Kolkata")
  })

  it("moratorium interest already posted by a payment is not added again", async () => {
    const rows = {
      ...ROWS,
      due_items: [...ROWS.due_items, { id: "emi-0", kind: "loan_emi", loan_id: "L1", status: "paid" }],
      due_payments: [{ due_item_id: "emi-0", capitalised_minor: 20_000_00, voided_at: null }],
    }
    const load = await loadNetWorthData(fakeClient(rows).client)
    if (!load.ok) throw new Error("load failed")
    expect(load.data.accounts?.pendingCapitalised).toEqual([])
    // A voided payment does not count as posted.
    const voided = await loadNetWorthData(fakeClient({ ...rows, due_payments: [{ due_item_id: "emi-0", capitalised_minor: 20_000_00, voided_at: "2026-10-27T00:00:00Z" }] }).client)
    if (!voided.ok) throw new Error("load failed")
    expect(voided.data.accounts?.pendingCapitalised).toEqual([{ accountId: "loan", minor: 20_000_00 }])
  })

  it("a part that fails is null, the others still load", async () => {
    const load = await loadNetWorthData(fakeClient(ROWS, ["fixed_deposits"]).client)
    if (!load.ok) throw new Error("load failed")
    expect([load.data.investments, load.data.accounts === null, load.data.statutory]).toEqual([null, false, []])
    expect(netWorth(load.data).totalMinor).toBeNull()
  })

  it("signed out", async () => {
    const { client } = fakeClient(ROWS)
    ;(client as unknown as { auth: { getUser: () => Promise<unknown> } }).auth.getUser = async () => ({ data: { user: null } })
    expect(await loadNetWorthData(client)).toEqual({ ok: false, reason: "unauthenticated" })
  })
})
