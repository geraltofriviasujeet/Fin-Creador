import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { loadPaymentContext, payDueItem } from "../loans/writers"
import { cardErrorMessage } from "./errors"
import { addBorrowing, addCard, editLiabilityPayment, enterStatement, payCard, repayBorrowing, setBorrowingDueDate, setBorrowingReturnPlan } from "./writers"

const KEY = "e8000000-0000-4000-8000-0000000000c1"
const CARD = "f8000000-0000-4000-8000-0000000000c1"
const STATEMENT = "f8000000-0000-4000-8000-0000000000c2"
const BILL = "f8000000-0000-4000-8000-0000000000c3"
const BORROWING = "f8000000-0000-4000-8000-0000000000c4"
const PAYMENT = "f8000000-0000-4000-8000-0000000000c5"
const BANK = "a8000000-0000-4000-8000-0000000000c1"
const CARD_ACCOUNT = "a8000000-0000-4000-8000-0000000000c2"
const BORROWING_ACCOUNT = "a8000000-0000-4000-8000-0000000000c3"

type DbError = { code: string; message: string; details?: string }
type Rpc = { fn: string; args: Record<string, unknown> }

/** Answers selects from `rows` (applying eq / in / is filters) and records RPCs. */
function fakeClient(rows: Record<string, Record<string, unknown>[]>, rpcAnswer: (call: Rpc) => { data: unknown; error: DbError | null } = () => ({ data: { id: "new", difference_minor: 0 }, error: null })) {
  const rpcs: Rpc[] = []
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
      maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(resolve),
    }
    return builder
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "user_local_today") return { data: "2026-10-28", error: null }
      rpcs.push({ fn, args })
      return rpcAnswer({ fn, args })
    },
    from,
  }
  return { client: client as unknown as UserClient, rpcs }
}

const ROWS = {
  profiles: [{ id: "user-1", currency: "INR" }],
  credit_cards: [{ id: CARD, account_id: CARD_ACCOUNT, currency: "INR", tracking_started_on: "2026-10-01", statement_day: 20, due_day: 8 }],
  card_statements: [{ id: STATEMENT, card_id: CARD }],
  borrowings: [
    {
      id: BORROWING,
      account_id: BORROWING_ACCOUNT,
      currency: "INR",
      borrowed_minor: 20_000_00,
      amount_to_return_minor: 20_000_00,
      return_on: "2026-12-31",
      return_plan: "once",
      instalment_count: null,
      repay_from_account_id: BANK,
    },
  ],
  due_items: [{ id: BILL, kind: "card_bill", loan_id: null, card_statement_id: STATEMENT, borrowing_id: null, currency: "INR" }],
  accounts: [
    { id: BANK, kind: "bank", name: "HDFC Savings", currency: "INR", opening_balance_date: "2026-01-01", opening_balance_minor: 10_000_00, archived_at: null },
    { id: CARD_ACCOUNT, kind: "card", name: "Travel card", currency: "INR", opening_balance_date: "2026-10-01", opening_balance_minor: -6_000_00, archived_at: null },
    { id: BORROWING_ACCOUNT, kind: "borrowing", name: "Ravi", currency: "INR", opening_balance_date: "2026-10-20", opening_balance_minor: -20_000_00, archived_at: null },
  ],
  account_balances: [{ account_id: CARD_ACCOUNT, inflow_minor: 0, outflow_minor: 2_000_00 }],
  liability_payments: [{ id: PAYMENT, liability_account_id: CARD_ACCOUNT, account_id: BANK, principal_minor: 3_000_00, interest_minor: 0, voided_at: null }],
}

describe("cardErrorMessage", () => {
  it("explains a non-zero balance when archiving, owed or in credit", () => {
    expect(cardErrorMessage({ code: "FC045", details: "250000" }, { subject: "card", currency: "INR" }).message).toBe(
      "You still owe ₹2,500 on this card. Archive it once nothing is owed.",
    )
    expect(cardErrorMessage({ code: "FC045", details: "-50000" }, { subject: "card", currency: "INR" }).message).toBe(
      "This card has ₹500 in credit. Archive it once the balance is zero.",
    )
    expect(cardErrorMessage({ code: "FC045", details: "100" }, { subject: "borrowing", currency: "INR" }).message).toBe(
      "You still owe ₹1 on this borrowing. Archive it once nothing is owed.",
    )
  })

  it("asks for the missing purchase when a payment is more than is owed", () => {
    expect(cardErrorMessage({ code: "FC047", details: "400000" }, { currency: "INR" })).toEqual({
      message: "That's more than you owe on this card (₹4,000). Record the missing purchase first",
      field: "amount",
    })
    expect(cardErrorMessage({ code: "FC047", details: "0" }, { currency: "INR", amountField: "principal" }).field).toBe("principal")
  })

  it("maps FC046 to FC051 and digits in names", () => {
    expect(cardErrorMessage({ code: "FC046" }).field).toBe("statementDate")
    expect(cardErrorMessage({ code: "FC048" }, { subject: "borrowing" }).message).toBe("This borrowing is archived. Restore it first.")
    expect(cardErrorMessage({ code: "FC049" }).message).toBe("Only purchases (expenses) can be recorded on a card.")
    expect(cardErrorMessage({ code: "FC050" }).message).toMatch(/can't be deleted/)
    expect(cardErrorMessage({ code: "FC051" }).field).toBe("dueDate")
    for (const [constraint, field] of [["credit_cards_issuer", "issuer"], ["credit_cards_nickname", "nickname"], ["borrowings_lender", "lender"]]) {
      expect(cardErrorMessage({ code: "23514", message: `violates check constraint "${constraint}"` })).toEqual({ message: "Leave out numbers: no card or account digits in names", field })
    }
  })

  it("offers Pay anyway with the shortfall", () => {
    expect(cardErrorMessage({ code: "FC035", details: "150000" }, { subject: "card", currency: "INR", accountName: "HDFC Savings" })).toEqual({
      message: "You need ₹1,500 more in HDFC Savings to pay this card",
      field: "accountId",
      shortfallMinor: 150000,
    })
  })

  it("never shows a raw database message", () => {
    expect(cardErrorMessage({ code: "XX000", message: "secret internals" }).message).not.toMatch(/secret/)
  })
})

describe("cards", () => {
  it("adds a card with what is owed today", async () => {
    const { client, rpcs } = fakeClient(ROWS)
    const r = await addCard(client, { issuer: "HDFC Bank", nickname: "Travel", limit: "1,00,000", statementDay: "20", dueDay: "8", openingOwed: "6,000", idempotencyKey: KEY })
    expect(r.status).toBe("success")
    expect(rpcs[0]).toEqual({
      fn: "create_card",
      args: { p_idempotency_key: KEY, p_issuer: "HDFC Bank", p_limit_minor: 1_00_000_00, p_statement_day: 20, p_due_day: 8, p_opening_owed_minor: 6_000_00, p_nickname: "Travel", p_product: undefined, p_product_other: false },
    })
  })

  it("enters a statement with the card's due day and the difference category", async () => {
    const { client, rpcs } = fakeClient(ROWS)
    await enterStatement(client, { cardId: CARD, statementDate: "2026-10-20", total: "9,000", minimum: "450", emiIncluded: "1,000", differenceCategoryId: STATEMENT, idempotencyKey: KEY })
    expect(rpcs[0]?.args).toMatchObject({ p_due_date: "2026-11-08", p_total_minor: 9_000_00, p_emi_included_minor: 1_000_00, p_difference_category_id: STATEMENT })
  })

  it("pays any amount up to what the card owes (opening 6,000 + purchases 2,000)", async () => {
    const { client, rpcs } = fakeClient(ROWS)
    const over = await payCard(client, { cardId: CARD, accountId: BANK, amount: "8,001", idempotencyKey: KEY })
    expect(over.status === "error" && over.fieldErrors).toEqual({ amount: "That's more than you owe on this card (₹8,000). Record the missing purchase first" })
    const ok = await payCard(client, { cardId: CARD, accountId: BANK, amount: "8,000", idempotencyKey: KEY })
    expect(ok.status).toBe("success")
    expect(rpcs[0]).toEqual({
      fn: "pay_card",
      args: { p_card_id: CARD, p_idempotency_key: KEY, p_account_id: BANK, p_paid_on: "2026-10-28", p_amount_minor: 8_000_00, p_allow_shortfall: false },
    })
  })

  it("edits a card payment as if the old one were undone (owed and balance back)", async () => {
    const { client, rpcs } = fakeClient(ROWS)
    // Owed is 8,000 now; with the old 3,000 undone, 11,000 may be paid; the bank has 10,000 + 3,000.
    const r = await editLiabilityPayment(client, { paymentId: PAYMENT, accountId: BANK, amount: "11,000", idempotencyKey: KEY })
    expect(r.status).toBe("success")
    expect(rpcs[0]).toMatchObject({ fn: "edit_liability_payment", args: { p_payment_id: PAYMENT, p_principal_minor: 11_000_00, p_interest_minor: 0 } })
  })

  it("a card bill's pay context is the card (owed, the day it was added)", async () => {
    const { client } = fakeClient(ROWS)
    const ctx = await loadPaymentContext(client, BILL)
    expect(ctx.ok && { kind: ctx.data.kind, owed: ctx.data.outstandingMinor, from: ctx.data.trackingStartedOn, accounts: ctx.data.accounts.map((a) => a.id) }).toEqual({
      kind: "card_bill",
      owed: 8_000_00,
      from: "2026-10-01",
      accounts: [BANK],
    })
  })

  it("pays a bill as one amount (no interest or fees)", async () => {
    const { client, rpcs } = fakeClient(ROWS, () => ({ data: { id: "pay" }, error: null }))
    const r = await payDueItem(client, { dueItemId: BILL, accountId: BANK, principal: "5,000", interest: "100", fees: "50", idempotencyKey: KEY })
    expect(r).toMatchObject({ status: "success", message: "Bill paid." })
    expect(rpcs[0]?.args).toMatchObject({ p_principal_minor: 5_000_00, p_interest_minor: 0, p_fees_minor: 0 })
  })
})

describe("borrowing", () => {
  it("records only what is owed when the money came earlier", async () => {
    const { client, rpcs } = fakeClient(ROWS)
    await addBorrowing(client, { lender: "Ravi", relationship: "family", amount: "20,000", received: "earlier", sameAsBorrowed: "true", idempotencyKey: KEY })
    expect(rpcs[0]).toEqual({
      fn: "create_borrowing",
      args: {
        p_idempotency_key: KEY,
        p_lender: "Ravi",
        p_amount_minor: 20_000_00,
        p_relationship: "family",
        p_reason: undefined,
        p_amount_to_return_minor: 20_000_00,
        p_received_account_id: undefined,
        p_received_on: undefined,
        p_return_on: undefined,
        p_return_plan: undefined,
        p_instalment_count: undefined,
        p_pay_from_account_id: undefined,
      },
    })
  })

  it("posts the money received into an account on a date", async () => {
    const { client, rpcs } = fakeClient(ROWS)
    await addBorrowing(client, {
      lender: "Ravi",
      relationship: "friends",
      reason: "Bike repair",
      amount: "20,000",
      received: "into_account",
      accountId: BANK,
      receivedOn: "2026-10-20",
      amountToReturn: "21,000",
      returnOn: "2026-12-31",
      returnPlan: "instalments",
      instalments: "3",
      payFromAccountId: BANK,
      idempotencyKey: KEY,
    })
    expect(rpcs[0]?.args).toMatchObject({
      p_received_account_id: BANK,
      p_received_on: "2026-10-20",
      p_reason: "Bike repair",
      p_amount_to_return_minor: 21_000_00,
      p_return_on: "2026-12-31",
      p_return_plan: "instalments",
      p_instalment_count: 3,
      p_pay_from_account_id: BANK,
    })
  })

  it("repays with interest, at most what is owed", async () => {
    const { client, rpcs } = fakeClient(ROWS)
    const over = await repayBorrowing(client, { borrowingId: BORROWING, accountId: BANK, principal: "20,001", idempotencyKey: KEY })
    expect(over.status === "error" && over.fieldErrors).toEqual({ principal: "That's more than you owe (₹20,000)" })
    await repayBorrowing(client, { borrowingId: BORROWING, accountId: BANK, principal: "5,000", interest: "200", idempotencyKey: KEY })
    expect(rpcs[0]?.args).toMatchObject({ p_principal_minor: 5_000_00, p_interest_minor: 200_00 })
  })

  it("removes the due date when it is left empty", async () => {
    const { client, rpcs } = fakeClient(ROWS)
    const r = await setBorrowingDueDate(client, { borrowingId: BORROWING, dueDate: "" })
    expect(r).toEqual({ status: "success", message: "Due date removed." })
    expect(rpcs[0]).toEqual({
      fn: "set_borrowing_return_plan",
      args: {
        p_borrowing_id: BORROWING,
        p_amount_to_return_minor: 20_000_00,
        p_return_on: undefined,
        p_return_plan: undefined,
        p_instalment_count: undefined,
        p_pay_from_account_id: undefined,
      },
    })
  })

  it("moves the return date and keeps the plan and its account", async () => {
    const { client, rpcs } = fakeClient(ROWS)
    const r = await setBorrowingDueDate(client, { borrowingId: BORROWING, dueDate: "2027-01-15" })
    expect(r).toEqual({ status: "success", message: "Due date saved." })
    expect(rpcs[0]?.args).toMatchObject({ p_return_on: "2027-01-15", p_return_plan: "once", p_pay_from_account_id: BANK, p_amount_to_return_minor: 20_000_00 })
  })

  it("sets a return plan in instalments", async () => {
    const { client, rpcs } = fakeClient(ROWS)
    const r = await setBorrowingReturnPlan(client, {
      borrowingId: BORROWING,
      amountToReturn: "21,000",
      returnOn: "2026-11-30",
      returnPlan: "instalments",
      instalments: "6",
      payFromAccountId: BANK,
    })
    expect(r).toEqual({ status: "success", message: "Return plan saved." })
    expect(rpcs[0]).toEqual({
      fn: "set_borrowing_return_plan",
      args: {
        p_borrowing_id: BORROWING,
        p_amount_to_return_minor: 21_000_00,
        p_return_on: "2026-11-30",
        p_return_plan: "instalments",
        p_instalment_count: 6,
        p_pay_from_account_id: BANK,
      },
    })
  })
})
