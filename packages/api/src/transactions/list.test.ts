import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { type LedgerRow, type PageCursor, loadTransactionPage, loadTransactionTotals, queryAmountMinor } from "./list"

function row(id: string, createdAt: string, occurredOn = "2026-10-20"): LedgerRow {
  return {
    id, created_at: createdAt, occurred_on: occurredOn, account_id: "acc", amount_minor: 100, category_id: "cat",
    counter_account_id: null, currency: "INR", idempotency_key: id, note: null, payment_mode: null,
    replaces_id: null, type: "expense", user_id: "u", void_idempotency_key: null, void_reason: null, voided_at: null,
    recurring_rule_id: null, occurrence_date: null,
  }
}

// Stand-in for the signed-in user's client: answers list_transactions with the pages given
// and records the arguments of every call.
function fakeClient(pages: LedgerRow[][], error: { code: string; message: string } | null = null) {
  const calls: Record<string, unknown>[] = []
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      expect(fn).toBe("list_transactions")
      calls.push(args)
      return { data: error ? null : (pages[calls.length - 1] ?? []), error }
    },
  } as unknown as UserClient
  return { client, calls }
}

const filters = { from: "2026-10-01", to: "2026-10-31" }
const id1 = "00000000-0000-4000-8000-000000000001"
const id2 = "00000000-0000-4000-8000-000000000002"

describe("loadTransactionPage", () => {
  it("passes created_at back exactly as the database sent it, microseconds included", async () => {
    const raw = "2026-10-20T09:15:42.123456+00:00"
    const { client, calls } = fakeClient([[row(id2, "2026-10-21T10:00:00.000001+00:00"), row(id1, raw)], []])

    const first = await loadTransactionPage(client, filters, { currency: "INR", limit: 2 })
    expect(first.ok && first.nextCursor).toBeTruthy()
    if (!first.ok || !first.nextCursor) return

    await loadTransactionPage(client, filters, { currency: "INR", cursor: first.nextCursor, limit: 2 })
    expect(calls[1]).toMatchObject({ p_after_occurred_on: "2026-10-20", p_after_created_at: raw, p_after_id: id1 })
    // Through a JS Date it would have become ...42.123Z and repeated or skipped rows.
    expect(calls[1]?.p_after_created_at).not.toBe(new Date(raw).toISOString())
  })

  it("starts without a cursor and returns none after a short page", async () => {
    const { client, calls } = fakeClient([[row(id1, "2026-10-20T09:15:42.123456+00:00")]])
    const page = await loadTransactionPage(client, filters, { currency: "INR", limit: 2 })
    expect(page).toMatchObject({ ok: true, nextCursor: null })
    expect(calls[0]).toMatchObject({ p_after_occurred_on: undefined, p_after_created_at: undefined, p_after_id: undefined })
  })

  it("refuses a cursor it did not produce, without calling the database", async () => {
    const { client, calls } = fakeClient([])
    for (const bad of ["", "not json", '["2026-10-20"]', '["2026-10-20", "yesterday", "x"]']) {
      const page = await loadTransactionPage(client, filters, { currency: "INR", cursor: bad as PageCursor })
      expect(page).toEqual({ ok: false, reason: "invalid_cursor" })
    }
    expect(calls).toHaveLength(0)
  })

  it("sends the search as literal text and, when it reads as one, an amount", async () => {
    const { client, calls } = fakeClient([[], []])
    await loadTransactionPage(client, { ...filters, query: " 1,250.50 " }, { currency: "INR" })
    await loadTransactionPage(client, { ...filters, query: "50% (team)" }, { currency: "INR" })
    expect(calls[0]).toMatchObject({ p_query: "1,250.50", p_amount_minor: 125050 })
    expect(calls[1]).toMatchObject({ p_query: "50% (team)", p_amount_minor: undefined })
  })

  it("reports a failed read as unavailable", async () => {
    const { client } = fakeClient([], { code: "42501", message: "raw database text" })
    expect(await loadTransactionPage(client, filters, { currency: "INR" })).toEqual({ ok: false, reason: "unavailable" })
  })
})

describe("queryAmountMinor", () => {
  it("reads amounts and ignores text", () => {
    expect(queryAmountMinor("100", "INR")).toBe(10000)
    expect(queryAmountMinor("groceries", "INR")).toBeNull()
    expect(queryAmountMinor("", "INR")).toBeNull()
  })
})

describe("loadTransactionTotals", () => {
  it("totals the profile currency and only counts other currencies", async () => {
    const client = {
      rpc: async () => ({
        data: [
          { currency: "INR", income_minor: 500000, expense_minor: 24500, income_count: 1, expense_count: 3, transfer_count: 1 },
          { currency: "USD", income_minor: 0, expense_minor: 300, income_count: 0, expense_count: 1, transfer_count: 0 },
        ],
        error: null,
      }),
    } as unknown as UserClient
    expect(await loadTransactionTotals(client, filters, "INR")).toEqual({
      ok: true,
      totals: { incomeMinor: 500000, expenseMinor: 24500, netMinor: 475500, incomeCount: 1, expenseCount: 3, transferCount: 1, otherCurrencyCount: 1 },
    })
  })
})
