import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { loanErrorMessage } from "./errors"
import { addLoan, loadPaymentContext, payDueItem, planDueItem } from "./writers"

const KEY = "e8000000-0000-4000-8000-0000000000a1"
const LOAN = "f8000000-0000-4000-8000-0000000000a1"
const DUE = "f8000000-0000-4000-8000-0000000000a2"
const BANK = "a8000000-0000-4000-8000-0000000000a1"
const CASH = "a8000000-0000-4000-8000-0000000000a2"
const LOAN_ACCOUNT = "a8000000-0000-4000-8000-0000000000a3"

type DbError = { code: string; message: string; details?: string }
type Rpc = { fn: string; args: Record<string, unknown> }

/** Answers selects from `rows` (applying eq / in / is filters) and records RPCs and updates. */
function fakeClient(rows: Record<string, Record<string, unknown>[]>, rpcAnswer: (call: Rpc) => { data: unknown; error: DbError | null }) {
  const rpcs: Rpc[] = []
  const updates: { table: string; values: unknown }[] = []
  const from = (table: string) => {
    let result = [...(rows[table] ?? [])]
    const builder = {
      select: () => builder,
      eq: (c: string, v: unknown) => ((result = result.filter((r) => r[c] === v)), builder),
      in: (c: string, v: unknown[]) => ((result = result.filter((r) => v.includes(r[c]))), builder),
      is: (c: string, v: unknown) => ((result = result.filter((r) => (r[c] ?? null) === v)), builder),
      gt: (c: string, v: number) => ((result = result.filter((r) => (r[c] as number) > v)), builder),
      order: () => builder,
      limit: () => builder,
      update: (values: unknown) => (updates.push({ table, values }), builder),
      maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(resolve),
    }
    return builder
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "user_local_today") return { data: "2026-10-27", error: null }
      rpcs.push({ fn, args })
      return rpcAnswer({ fn, args })
    },
    from,
  }
  return { client: client as unknown as UserClient, rpcs, updates }
}

const ROWS = {
  profiles: [{ id: "user-1", currency: "INR" }],
  due_items: [{ id: DUE, kind: "loan_emi", loan_id: LOAN, currency: "INR" }],
  loans: [{ id: LOAN, account_id: LOAN_ACCOUNT, tracking_started_on: "2026-10-20", moratorium_interest: "capitalise", capitalised_minor: 30_000 }],
  accounts: [
    { id: BANK, kind: "bank", name: "HDFC Savings", last4: null, currency: "INR", opening_balance_date: "2026-01-01", opening_balance_minor: 50_000_00, archived_at: null },
    { id: CASH, kind: "cash", name: "Cash in hand", last4: null, currency: "INR", opening_balance_date: "2026-01-01", opening_balance_minor: 2_000_00, archived_at: null },
    { id: LOAN_ACCOUNT, kind: "loan", name: "HDFC Bank", last4: null, currency: "INR", opening_balance_date: "2026-10-20", opening_balance_minor: -10_00_000_00, archived_at: null },
  ],
  account_balances: [{ account_id: LOAN_ACCOUNT, inflow_minor: 0, outflow_minor: 0 }],
  due_payments: [],
}

const pay = { dueItemId: DUE, accountId: CASH, paidOn: "", principal: "5,000", interest: "1,000", fees: "", idempotencyKey: KEY }

describe("loadPaymentContext", () => {
  it("offers only money accounts, with balances, and adds moratorium interest still to come", async () => {
    const { client } = fakeClient(ROWS, () => ({ data: null, error: null }))
    const ctx = await loadPaymentContext(client, DUE)
    expect(ctx.ok).toBe(true)
    if (!ctx.ok) return
    expect(ctx.data.accounts.map((a) => [a.id, a.balanceMinor])).toEqual([
      [BANK, 50_000_00],
      [CASH, 2_000_00],
    ])
    expect(ctx.data.outstandingMinor).toBe(10_00_000_00 + 30_000)
    expect(ctx.data.trackingStartedOn).toBe("2026-10-20")
  })

  it("does not add it again once a payment of this loan carries it", async () => {
    const { client } = fakeClient({ ...ROWS, due_payments: [{ id: "p1", due_item_id: DUE, voided_at: null, capitalised_minor: 30_000 }] }, () => ({ data: null, error: null }))
    const ctx = await loadPaymentContext(client, DUE)
    expect(ctx.ok && ctx.data.outstandingMinor).toBe(10_00_000_00)
  })
})

describe("payDueItem", () => {
  it("warns when the account is short, with the amount, and sends nothing", async () => {
    const { client, rpcs } = fakeClient(ROWS, () => ({ data: null, error: null }))
    const result = await payDueItem(client, pay)
    expect(result).toEqual({
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { accountId: "You need ₹4,000 more in Cash in hand to pay this EMI" },
      shortfallMinor: 4_000_00,
    })
    expect(rpcs).toEqual([])
  })

  it("Pay anyway sends the same request with the flag", async () => {
    const { client, rpcs } = fakeClient(ROWS, () => ({ data: { id: "pay-1" }, error: null }))
    const result = await payDueItem(client, { ...pay, allowShortfall: "true" })
    expect(result).toEqual({ status: "success", message: "EMI paid.", paymentId: "pay-1" })
    expect(rpcs[0]).toEqual({
      fn: "pay_due_item",
      args: {
        p_due_item_id: DUE,
        p_idempotency_key: KEY,
        p_account_id: CASH,
        p_paid_on: "2026-10-27",
        p_principal_minor: 5_000_00,
        p_interest_minor: 1_000_00,
        p_fees_minor: 0,
        p_allow_shortfall: true,
      },
    })
  })

  it("a shortfall the database finds (the balance changed) says how much more", async () => {
    const { client } = fakeClient(ROWS, () => ({ data: null, error: { code: "FC035", message: "x", details: "12345" } }))
    const result = await payDueItem(client, { ...pay, accountId: BANK })
    expect(result).toMatchObject({ status: "error", fieldErrors: { accountId: "You need ₹123.45 more in HDFC Savings to pay this EMI" }, shortfallMinor: 12_345 })
  })
})

describe("addLoan", () => {
  const loan = {
    loanType: "credit_card_emi",
    lender: "HDFC Bank",
    nickname: "HDFC Regalia",
    sanctioned: "60,000",
    disbursed: "60,000",
    rate: "0",
    tenureMonths: "6",
    startMode: "ongoing",
    outstanding: "60,000",
    remainingMonths: "6",
    nextDueDate: "2026-10-05",
    thisMonthPaid: "due",
    idempotencyKey: KEY,
  }

  it("sends the figures from the domain; optional values are left out, not null", async () => {
    const { client, rpcs } = fakeClient(ROWS, () => ({ data: { id: LOAN }, error: null }))
    expect(await addLoan(client, loan)).toEqual({ status: "success", message: "Loan added.", loanId: LOAN })
    expect(rpcs[0]?.args).toMatchObject({
      p_loan_type: "credit_card_emi",
      p_nickname: "HDFC Regalia",
      p_instalment_months: 6,
      p_first_due_date: "2026-10-05",
      p_emi_minor: 10_000_00,
      p_type_other: undefined,
      p_before_tracking_on: undefined,
    })
  })

  it("maps the digits rule from the database to the field", async () => {
    const { client } = fakeClient(ROWS, () => ({ data: null, error: { code: "23514", message: 'new row for relation "loans" violates check constraint "loans_nickname"' } }))
    expect(await addLoan(client, loan)).toMatchObject({ fieldErrors: { nickname: "Leave out card and account numbers" } })
  })
})

describe("planDueItem", () => {
  it("stores the planned date and account", async () => {
    const { client, updates } = fakeClient(ROWS, () => ({ data: null, error: null }))
    const result = await planDueItem(client, { dueItemId: DUE, accountId: BANK, plannedOn: "2026-11-01" })
    expect(updates).toEqual([{ table: "due_items", values: { planned_on: "2026-11-01", planned_account_id: BANK } }])
    expect(result.status).toBe("success")
  })
})

describe("loanErrorMessage", () => {
  it("never shows raw database text", () => {
    expect(loanErrorMessage({ code: "FC034", message: "raw" }).message).not.toContain("raw")
    expect(loanErrorMessage({ code: "FC037", message: "raw" })).toEqual({ message: "Principal can't be more than you owe.", field: "principal" })
    expect(loanErrorMessage({ code: "23514", message: 'violates check constraint "loans_lender"' })).toEqual({ message: "Leave out card and account numbers", field: "lender" })
    expect(loanErrorMessage({ code: "FC035", message: "raw" }).field).toBe("accountId")
    expect(loanErrorMessage({ code: "XX000", message: "raw" }).message).toBe("We couldn’t save that. Please try again.")
  })
})
