import { describe, expect, it } from "vitest"
import { type EntryRow, readBalanceChanges } from "./balance-feedback"
import type { UserClient } from "./income/client"

// Stand-in for the signed-in user's client: answers the two reads made after a save.
type Tables = {
  accounts?: { id: string; kind: string; name: string; last4: string | null; currency: string; opening_balance_minor: number; opening_balance_date: string }[]
  account_balances?: { account_id: string; inflow_minor: number; outflow_minor: number }[]
  fail?: "accounts" | "account_balances"
}

function fakeClient(t: Tables) {
  const reads: string[] = []
  const client = {
    from: (table: "accounts" | "account_balances") => ({
      select: () => ({
        in: async () => {
          reads.push(table)
          return t.fail === table ? { data: null, error: { code: "08006" } } : { data: t[table] ?? [], error: null }
        },
      }),
    }),
  }
  return { client: client as unknown as UserClient, reads }
}

const HDFC = { id: "hdfc", kind: "bank", name: "HDFC Bank", last4: null, currency: "INR", opening_balance_minor: 5_000_000, opening_balance_date: "2026-01-01" }
const CASH = { id: "cash", kind: "cash", name: "Cash in hand", last4: null, currency: "INR", opening_balance_minor: 0, opening_balance_date: "2026-01-01" }
const CARD = { id: "card", kind: "card", name: "HDFC card", last4: "1234", currency: "INR", opening_balance_minor: 0, opening_balance_date: "2026-01-01" }
const row = (over: Partial<EntryRow>): EntryRow => ({ type: "expense", amount_minor: 50_000, occurred_on: "2026-11-20", account_id: "hdfc", counter_account_id: null, ...over })

describe("readBalanceChanges", () => {
  it("after from the server's posted sums; before = after − this entry", async () => {
    const { client, reads } = fakeClient({ accounts: [HDFC], account_balances: [{ account_id: "hdfc", inflow_minor: 230_000, outflow_minor: 50_000 }] })
    expect(await readBalanceChanges(client, [row({})])).toEqual([
      { accountId: "hdfc", name: "HDFC Bank", label: "HDFC Bank", currency: "INR", beforeMinor: 5_230_000, afterMinor: 5_180_000 },
    ])
    expect(reads.sort()).toEqual(["account_balances", "accounts"])
  })

  it("a transfer: both accounts, in the entry's order", async () => {
    const { client } = fakeClient({
      accounts: [CASH, HDFC],
      account_balances: [
        { account_id: "hdfc", inflow_minor: 0, outflow_minor: 100_000 },
        { account_id: "cash", inflow_minor: 100_000, outflow_minor: 0 },
      ],
    })
    const changes = await readBalanceChanges(client, [row({ type: "transfer", amount_minor: 100_000, counter_account_id: "cash" })])
    expect(changes?.map((c) => [c.name, c.beforeMinor, c.afterMinor])).toEqual([
      ["HDFC Bank", 5_000_000, 4_900_000],
      ["Cash in hand", 0, 100_000],
    ])
  })

  it("an edit: new effect − old effect", async () => {
    const { client } = fakeClient({ accounts: [HDFC], account_balances: [{ account_id: "hdfc", inflow_minor: 0, outflow_minor: 80_000 }] })
    const changes = await readBalanceChanges(client, [row({ amount_minor: 80_000 })], [row({ amount_minor: 50_000 })])
    expect(changes).toEqual([{ accountId: "hdfc", name: "HDFC Bank", label: "HDFC Bank", currency: "INR", beforeMinor: 4_950_000, afterMinor: 4_920_000 }])
  })

  it("card and loan accounts are left out (what is owed is shown on its own page)", async () => {
    const { client } = fakeClient({ accounts: [CARD], account_balances: [{ account_id: "card", inflow_minor: 0, outflow_minor: 50_000 }] })
    expect(await readBalanceChanges(client, [row({ account_id: "card" })])).toEqual([])
  })

  it.each(["accounts", "account_balances"] as const)("a failed %s read: undefined (the client shows Saved)", async (fail) => {
    const { client } = fakeClient({ accounts: [HDFC], account_balances: [], fail })
    expect(await readBalanceChanges(client, [row({})])).toBeUndefined()
  })

  it("an unknown entry type: undefined", async () => {
    const { client, reads } = fakeClient({ accounts: [HDFC] })
    expect(await readBalanceChanges(client, [row({ type: "investment" })])).toBeUndefined()
    expect(reads).toEqual([])
  })
})
