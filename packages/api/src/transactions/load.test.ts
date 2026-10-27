import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { loadIncomeData } from "../income/load"
import { ledgerLookup } from "./filters"
import { accountName } from "./format"
import { loadTransactionsContext } from "./load"

// Loan (liability) accounts, Sprint 8a: never on the Income page, in Total available, in a
// picker or in balances; only their name, on the entries of loan payments.

const account = (id: string, kind: string, name: string, opening: number) => ({
  id,
  kind,
  bank_type: kind === "bank" ? "savings" : null,
  name,
  institution: kind === "loan" ? "HDFC Bank" : null,
  last4: null,
  currency: "INR",
  opening_balance_minor: opening,
  opening_balance_date: "2026-10-01",
  archived_at: null,
  updated_at: "2026-10-01T00:00:00Z",
})

const ROWS: Record<string, unknown[]> = {
  profiles: [{ currency: "INR", time_zone: "Asia/Kolkata" }],
  accounts: [account("bank", "bank", "HDFC Bank", 50_000_00), account("cash", "cash", "Cash in hand", 2_000_00), account("loan", "loan", "HDFC Bank", -25_00_000_00)],
  account_balances: [
    { account_id: "bank", inflow_minor: 0, outflow_minor: 0, last_activity_at: null },
    { account_id: "loan", inflow_minor: 5_000_00, outflow_minor: 0, last_activity_at: null },
  ],
  categories: [
    { id: "inc", kind: "income", name: "Salary", source_type: "salary", icon: null, default_account_id: null, is_default: true, key: null, archived_at: null },
    { id: "exp", kind: "expense", name: "Loan interest", source_type: null, icon: "bills", default_account_id: null, is_default: true, key: null, archived_at: null },
  ],
  // The latest expense is capitalised interest on the loan account.
  transactions: [{ account_id: "loan", id: "t1" }],
}

/** Answers selects from ROWS, applying `.in()` and `.eq()` filters the loaders send. */
function fakeClient() {
  const from = (table: string) => {
    let rows = [...(ROWS[table] ?? [])] as Record<string, unknown>[]
    const builder = {
      select: () => builder,
      eq: (col: string, value: unknown) => {
        if (table !== "transactions" && table !== "profiles") rows = rows.filter((r) => r[col] === value)
        return builder
      },
      in: (col: string, values: unknown[]) => {
        rows = rows.filter((r) => values.includes(r[col]))
        return builder
      },
      is: () => builder,
      not: () => builder,
      gte: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === "transactions" ? [] : rows, error: null }).then(resolve),
    }
    return builder
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async (fn: string) => (fn === "user_local_today" ? { data: "2026-10-27", error: null } : { data: 0, error: null }),
    from,
  } as unknown as UserClient
}

describe("loan accounts are never money accounts", () => {
  it("the Income page (Accounts, Total available) asks only for bank, cash and other accounts", async () => {
    const result = await loadIncomeData(fakeClient())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.accounts.map((a) => a.id)).toEqual(["bank", "cash"])
  })

  it("pickers and balances get money accounts; loan accounts only label entries", async () => {
    const result = await loadTransactionsContext(fakeClient())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { accounts, loanAccounts, lastExpenseAccountId } = result.data
    expect(accounts.map((a) => [a.id, a.kind])).toEqual([
      ["bank", "bank"],
      ["cash", "cash"],
    ])
    expect(loanAccounts).toEqual([{ id: "loan", label: "HDFC Bank (loan)", archived: false }])
    // Never the default account of a new expense.
    expect(lastExpenseAccountId).toBeNull()
    // A loan payment's transfer names both sides; a bank and a loan with the same name differ.
    const lookup = ledgerLookup(result.data)
    expect(accountName("bank", lookup)).toBe("HDFC Bank")
    expect(accountName("loan", lookup)).toBe("HDFC Bank (loan)")
  })
})
