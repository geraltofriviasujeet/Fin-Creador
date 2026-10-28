import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { loanErrorMessage } from "./errors"
import { clearDuePlan, editDuePayment, voidDuePayment } from "./writers"

// QA (Sprint 8a): editing and voiding payments, clearing a plan, and every loan error code.

const DUE = "f8000000-0000-4000-8000-0000000000b2"
const LOAN = "f8000000-0000-4000-8000-0000000000b1"
const PAYMENT = "f8000000-0000-4000-8000-0000000000b3"
const BANK = "a8000000-0000-4000-8000-0000000000b1"
const CASH = "a8000000-0000-4000-8000-0000000000b2"
const LOAN_ACCOUNT = "a8000000-0000-4000-8000-0000000000b3"
const KEY = "e8000000-0000-4000-8000-0000000000b1"

type DbError = { code: string; message: string; details?: string }
type Rpc = { fn: string; args: Record<string, unknown> }

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

// Cash holds 200,000 paise (₹2,000), the bank 5,000,000; the loan owes 100,000,000 and nothing is posted.
const account = (id: string, kind: string, name: string, opening: number) => ({
  id,
  kind,
  name,
  last4: null,
  currency: "INR",
  opening_balance_date: "2026-01-01",
  opening_balance_minor: opening,
  archived_at: null,
})
const rows = (payment: { account_id: string; principal_minor: number; interest_minor: number; fees_minor: number }) => ({
  profiles: [{ id: "user-1", currency: "INR" }],
  due_items: [{ id: DUE, kind: "loan_emi", loan_id: LOAN, currency: "INR" }],
  loans: [{ id: LOAN, account_id: LOAN_ACCOUNT, tracking_started_on: "2026-10-20", moratorium_interest: null, capitalised_minor: 0 }],
  accounts: [account(BANK, "bank", "HDFC Savings", 5_000_000), account(CASH, "cash", "Cash in hand", 200_000), account(LOAN_ACCOUNT, "loan", "Home loan", -100_000_000)],
  account_balances: [],
  due_payments: [{ id: PAYMENT, due_item_id: DUE, voided_at: null, capitalised_minor: 0, ...payment }],
})

const edit = { paymentId: PAYMENT, accountId: CASH, paidOn: "", principal: "", interest: "", fees: "", idempotencyKey: KEY }

describe("editDuePayment", () => {
  it("moving a payment to an account that is short warns with the amount and sends nothing", async () => {
    // Paid ₹6,000 from the bank; moved to cash (₹2,000): the old payment's money is not in cash.
    const { client, rpcs } = fakeClient(rows({ account_id: BANK, principal_minor: 500_000, interest_minor: 100_000, fees_minor: 0 }), () => ({ data: null, error: null }))
    const result = await editDuePayment(client, { ...edit, principal: "5,000", interest: "1,000" })
    expect(result).toMatchObject({ status: "error", shortfallMinor: 400_000, fieldErrors: { accountId: "You need ₹4,000 more in Cash in hand to pay this EMI" } })
    expect(rpcs).toEqual([])
  })

  it("counts the old payment's money as back in its own account before checking the new split", async () => {
    // Paid ₹100 from cash (₹2,000): the new total of ₹2,100 fits only because the ₹100 is returned first.
    const { client, rpcs } = fakeClient(rows({ account_id: CASH, principal_minor: 10_000, interest_minor: 0, fees_minor: 0 }), () => ({ data: { id: "new-1" }, error: null }))
    const result = await editDuePayment(client, { ...edit, principal: "2,100" })
    expect(result).toEqual({ status: "success", message: "Payment saved.", paymentId: "new-1" })
    expect(rpcs).toHaveLength(1)
    expect(rpcs[0]).toEqual({
      fn: "edit_due_payment",
      args: {
        p_payment_id: PAYMENT,
        p_idempotency_key: KEY,
        p_account_id: CASH,
        p_paid_on: "2026-10-27",
        p_principal_minor: 210_000,
        p_interest_minor: 0,
        p_fees_minor: 0,
        p_allow_shortfall: false,
      },
    })
  })

  it("one rupee more than that is short, by exactly one rupee", async () => {
    const { client, rpcs } = fakeClient(rows({ account_id: CASH, principal_minor: 10_000, interest_minor: 0, fees_minor: 0 }), () => ({ data: null, error: null }))
    const result = await editDuePayment(client, { ...edit, principal: "2,101" })
    expect(result).toMatchObject({ status: "error", shortfallMinor: 100 })
    expect(rpcs).toEqual([])
  })

  it("a payment that is gone (voided or someone else's) is not found", async () => {
    const { client, rpcs } = fakeClient(rows({ account_id: CASH, principal_minor: 1, interest_minor: 0, fees_minor: 0 }), () => ({ data: null, error: null }))
    const result = await editDuePayment(client, { ...edit, paymentId: "f8000000-0000-4000-8000-0000000000ff", principal: "1" })
    expect(result.status).toBe("error")
    expect(rpcs).toEqual([])
  })

  it("a stale edit and a nothing-changed edit from the database become plain messages", async () => {
    const stale = fakeClient(rows({ account_id: CASH, principal_minor: 10_000, interest_minor: 0, fees_minor: 0 }), () => ({ data: null, error: { code: "FC014", message: "raw" } }))
    const staleResult = await editDuePayment(stale.client, { ...edit, principal: "50" })
    expect(staleResult.status).toBe("error")
    expect(JSON.stringify(staleResult)).not.toContain("raw")
  })
})

describe("voidDuePayment", () => {
  it("sends the request key and a trimmed reason; a blank reason is left out", async () => {
    const a = fakeClient(rows({ account_id: CASH, principal_minor: 1, interest_minor: 0, fees_minor: 0 }), () => ({ data: { id: PAYMENT }, error: null }))
    expect(await voidDuePayment(a.client, { paymentId: PAYMENT, idempotencyKey: KEY, reason: "  wrong account  " })).toEqual({
      status: "success",
      message: "Payment voided.",
      paymentId: PAYMENT,
    })
    expect(a.rpcs[0]).toEqual({ fn: "void_due_payment", args: { p_payment_id: PAYMENT, p_idempotency_key: KEY, p_reason: "wrong account" } })
    const b = fakeClient(rows({ account_id: CASH, principal_minor: 1, interest_minor: 0, fees_minor: 0 }), () => ({ data: { id: PAYMENT }, error: null }))
    await voidDuePayment(b.client, { paymentId: PAYMENT, idempotencyKey: KEY, reason: "   " })
    expect(b.rpcs[0]?.args.p_reason).toBeUndefined()
  })

  it("an archived loan is explained, not shown as raw database text", async () => {
    const { client } = fakeClient(rows({ account_id: CASH, principal_minor: 1, interest_minor: 0, fees_minor: 0 }), () => ({ data: null, error: { code: "FC033", message: "Loan is archived" } }))
    expect(await voidDuePayment(client, { paymentId: PAYMENT, idempotencyKey: KEY })).toEqual({ status: "error", message: "This loan is archived. Restore it first." })
  })
})

describe("clearDuePlan", () => {
  it("clears both the date and the account", async () => {
    const { client, updates } = fakeClient(rows({ account_id: CASH, principal_minor: 1, interest_minor: 0, fees_minor: 0 }), () => ({ data: null, error: null }))
    expect(await clearDuePlan(client, { dueItemId: DUE })).toEqual({ status: "success", message: "Plan removed." })
    expect(updates).toEqual([{ table: "due_items", values: { planned_on: null, planned_account_id: null } }])
  })

  it("an EMI that is not visible (someone else's) is not found", async () => {
    const { client } = fakeClient(rows({ account_id: CASH, principal_minor: 1, interest_minor: 0, fees_minor: 0 }), () => ({ data: null, error: null }))
    expect((await clearDuePlan(client, { dueItemId: "f8000000-0000-4000-8000-0000000000ff" })).status).toBe("error")
  })
})

describe("loanErrorMessage, every loan error code", () => {
  const CODES = ["FC032", "FC033", "FC034", "FC036", "FC037", "FC038", "FC039", "FC040", "FC041", "FC042", "FC043", "FC044"]

  it("gives each code its own plain message, never the raw text", () => {
    const seen = new Set<string>()
    for (const code of CODES) {
      const m = loanErrorMessage({ code, message: "raw database text" })
      expect(m.message.length).toBeGreaterThan(5)
      expect(m.message).not.toContain("raw")
      seen.add(m.message)
    }
    expect(seen.size).toBe(CODES.length)
  })

  it("points field errors at the field the person can fix", () => {
    expect(loanErrorMessage({ code: "FC036", message: "x" }).field).toBe("paidOn")
    expect(loanErrorMessage({ code: "FC037", message: "x" }).field).toBe("principal")
    expect(loanErrorMessage({ code: "FC038", message: "x" }).field).toBe("accountId")
    expect(loanErrorMessage({ code: "FC039", message: "x" }).field).toBe("paidOn")
    expect(loanErrorMessage({ code: "FC041", message: "x" }).field).toBe("plannedOn")
    expect(loanErrorMessage({ code: "FC043", message: "x" }).field).toBe("nextDueDate")
  })

  it("FC035 carries the shortfall in minor units only when it is a positive whole number", () => {
    const ctx = { currency: "INR", accountName: "Cash in hand" }
    expect(loanErrorMessage({ code: "FC035", message: "x", details: "1" }, ctx)).toMatchObject({ shortfallMinor: 1, field: "accountId" })
    expect(loanErrorMessage({ code: "FC035", message: "x", details: "39424" }, ctx)).toMatchObject({
      shortfallMinor: 39_424,
      message: "You need ₹394.24 more in Cash in hand to pay this EMI",
    })
    for (const details of ["0", "-5", "1.5", "abc", "", null, undefined]) {
      const m = loanErrorMessage({ code: "FC035", message: "x", details }, ctx)
      expect(m.shortfallMinor).toBeUndefined()
      expect(m.message).toBe("This account doesn't have enough money for this EMI.")
    }
    // Without a currency the amount cannot be formatted, so no "Pay anyway" amount is offered.
    expect(loanErrorMessage({ code: "FC035", message: "x", details: "100" }).shortfallMinor).toBeUndefined()
  })
})
