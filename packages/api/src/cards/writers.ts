import { MONEY_ACCOUNT_KINDS, outstandingFromBalance } from "@fin-creador/domain"
import {
  type PayingAccount,
  borrowingEditFormSchema,
  borrowingFormSchema,
  borrowingReturnPlanFormSchema,
  cardEditFormSchema,
  cardFormSchema,
  cardPaymentFormSchema,
  firstFieldErrors,
  repaymentFormSchema,
  statementFormSchema,
} from "@fin-creador/schemas"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "../income/client"
import type { WriteResult } from "../income/types"
import type { FormInput } from "../income/writers"
import { accountBalances } from "../loans/writers"
import { type CardErrorContext, cardErrorMessage } from "./errors"

// Writes for credit cards, statements and informal borrowing, shared by web and mobile. They
// run as the signed-in user through the functions of migrations 20261028180000 and
// 20261028210000 (RLS and grants
// apply; the database refuses any direct write). Every add and payment carries a request key.
// Bill payments (pay_due_item) and "Will pay later" go through the loan writers.

const FIX_FIELDS = "Please fix the highlighted fields."
const SIGNED_OUT = "Your session has ended. Please sign in again."
const UNAVAILABLE = "We couldn't load your accounts. Check your connection and try again."
const CARD_NOT_FOUND = "We couldn't find that card. Reload and try again."
const BORROWING_NOT_FOUND = "We couldn't find that borrowing. Reload and try again."
const PAYMENT_NOT_FOUND = "We couldn't find that payment. Reload and try again."

export type CardWriteError = WriteResult & {
  status: "error"
  /** FC035 or the form's own check: the account is short; offer "Pay anyway". */
  shortfallMinor?: number
}
export type CardWriteResult = CardWriteError | { status: "success"; message: string; id: string }

function dbError(error: { code?: string; message?: string; details?: string | null }, ctx: CardErrorContext = {}): CardWriteError {
  const m = cardErrorMessage(error, ctx)
  const base: CardWriteError = m.field ? { status: "error", message: FIX_FIELDS, fieldErrors: { [m.field]: m.message } } : { status: "error", message: m.message }
  return m.shortfallMinor ? { ...base, shortfallMinor: m.shortfallMinor } : base
}

function formError(error: Parameters<typeof firstFieldErrors>[0]): CardWriteError {
  const result: CardWriteError = { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(error) }
  const issue = error.issues.find((i) => i.path[0] === "accountId")
  const shortfallMinor = (issue as { params?: { shortfallMinor?: unknown } } | undefined)?.params?.shortfallMinor
  return typeof shortfallMinor === "number" ? { ...result, shortfallMinor } : result
}

async function profileCurrency(supabase: UserClient, userId: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("currency").eq("id", userId).maybeSingle()
  return data?.currency ?? null
}

/** Active bank, cash and other accounts with balances (names only: no digits on these screens). */
async function payingAccounts(supabase: UserClient, extraIds: string[] = []): Promise<{ accounts: PayingAccount[]; balances: Map<string, number> } | null> {
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, currency, opening_balance_date")
    .in("kind", [...MONEY_ACCOUNT_KINDS])
    .is("archived_at", null)
    .order("created_at")
  if (error) return null
  const balances = await accountBalances(supabase, [...extraIds, ...data.map((a) => a.id)])
  if (!balances) return null
  return {
    balances,
    accounts: data.map((a) => ({ id: a.id, name: a.name, currency: a.currency, balanceMinor: balances.get(a.id) ?? 0, openingBalanceDate: a.opening_balance_date })),
  }
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export async function addCard(supabase: UserClient, input: FormInput): Promise<CardWriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return { status: "error", message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const currency = await profileCurrency(supabase, day.userId)
  if (!currency) return { status: "error", message: UNAVAILABLE }
  const parsed = cardFormSchema({ currency }).safeParse(input)
  if (!parsed.success) return formError(parsed.error)
  const c = parsed.data
  const { data, error } = await supabase.rpc("create_card", {
    p_idempotency_key: c.idempotencyKey,
    p_issuer: c.issuer,
    p_limit_minor: c.limitMinor,
    p_statement_day: c.statementDay,
    p_due_day: c.dueDay,
    p_opening_owed_minor: c.openingOwedMinor,
    p_nickname: c.nickname ?? undefined,
    p_product: c.product ?? undefined,
    p_product_other: c.productOther,
  })
  if (error || !data) return dbError(error ?? {}, { currency })
  return { status: "success", message: "Card added.", id: data.id }
}

export async function editCard(supabase: UserClient, input: FormInput): Promise<CardWriteResult> {
  const { data: card, error: cardError } = await supabase.from("credit_cards").select("id, currency").eq("id", input.cardId ?? "").maybeSingle()
  if (cardError) return { status: "error", message: UNAVAILABLE }
  if (!card) return { status: "error", message: CARD_NOT_FOUND }
  const parsed = cardEditFormSchema({ currency: card.currency }).safeParse(input)
  if (!parsed.success) return formError(parsed.error)
  const c = parsed.data
  const { error } = await supabase.rpc("update_card", {
    p_card_id: c.cardId,
    p_issuer: c.issuer,
    p_limit_minor: c.limitMinor,
    p_statement_day: c.statementDay,
    p_due_day: c.dueDay,
    p_nickname: c.nickname ?? undefined,
    p_product: c.product ?? undefined,
    p_product_other: c.productOther,
  })
  if (error) return dbError(error)
  return { status: "success", message: "Card saved.", id: c.cardId }
}

/** Archive (only at a zero balance) or restore a card. */
export async function setCardArchived(supabase: UserClient, input: { cardId: string; archived: boolean; currency?: string }): Promise<CardWriteResult> {
  const { error } = await supabase.rpc("set_card_archived", { p_card_id: input.cardId, p_archived: input.archived })
  if (error) return dbError(error, { subject: "card", currency: input.currency })
  return { status: "success", message: input.archived ? "Card archived." : "Card restored.", id: input.cardId }
}

/** Deletes a card with no purchases, statements or payments (it can't be undone). */
export async function deleteCard(supabase: UserClient, input: { cardId: string }): Promise<WriteResult> {
  const { error } = await supabase.rpc("delete_card", { p_card_id: input.cardId })
  if (error) return dbError(error)
  return { status: "success", message: "Card deleted." }
}

/** Links a credit card EMI (a loan) to its card, or unlinks it (`cardId` null), to fill "EMIs included". */
export async function linkCardEmi(supabase: UserClient, input: { loanId: string; cardId: string | null }): Promise<WriteResult> {
  const { error } = await supabase.rpc("link_card_emi", { p_loan_id: input.loanId, p_card_id: input.cardId ?? undefined })
  if (error) return dbError(error)
  return { status: "success", message: input.cardId ? "EMI linked to the card." : "EMI unlinked." }
}

export type CardContext = {
  today: string
  currency: string
  cardId: string
  accountId: string
  trackingStartedOn: string
  statementDay: number
  dueDay: number
  /** What the card owes now (0 when it is in credit). */
  owedMinor: number
  accounts: PayingAccount[]
}

/** What the statement and payment forms check against, read as the signed-in user. */
export async function loadCardContext(supabase: UserClient, cardId: string): Promise<{ ok: true; data: CardContext } | { ok: false; message: string }> {
  const day = await userToday(supabase)
  if (!day.ok) return { ok: false, message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const { data: card, error } = await supabase
    .from("credit_cards")
    .select("id, account_id, currency, tracking_started_on, statement_day, due_day")
    .eq("id", cardId)
    .maybeSingle()
  if (error) return { ok: false, message: UNAVAILABLE }
  if (!card) return { ok: false, message: CARD_NOT_FOUND }
  const paying = await payingAccounts(supabase, [card.account_id])
  if (!paying) return { ok: false, message: UNAVAILABLE }
  return {
    ok: true,
    data: {
      today: day.today,
      currency: card.currency,
      cardId: card.id,
      accountId: card.account_id,
      trackingStartedOn: card.tracking_started_on,
      statementDay: card.statement_day,
      dueDay: card.due_day,
      owedMinor: outstandingFromBalance(paying.balances.get(card.account_id) ?? 0),
      accounts: paying.accounts,
    },
  }
}

/** Enters a statement; with `differenceCategoryId`, records what is missing as an expense. */
export async function enterStatement(supabase: UserClient, input: FormInput): Promise<CardWriteResult> {
  const ctx = await loadCardContext(supabase, input.cardId ?? "")
  if (!ctx.ok) return { status: "error", message: ctx.message }
  const parsed = statementFormSchema({ today: ctx.data.today, currency: ctx.data.currency, card: ctx.data }).safeParse(input)
  if (!parsed.success) return formError(parsed.error)
  const s = parsed.data
  const { data, error } = await supabase.rpc("enter_card_statement", {
    p_card_id: s.cardId,
    p_idempotency_key: s.idempotencyKey,
    p_statement_date: s.statementDate,
    p_total_minor: s.totalMinor,
    p_minimum_minor: s.minimumMinor,
    p_due_date: s.dueDate,
    p_emi_included_minor: s.emiIncludedMinor,
    p_difference_category_id: s.differenceCategoryId ?? undefined,
  })
  if (error || !data) return dbError(error ?? {}, { currency: ctx.data.currency })
  return { status: "success", message: data.difference_minor > 0 ? "Statement saved, with the difference recorded." : "Statement saved.", id: data.id }
}

/** Deletes a statement entered by mistake, while its bill has no payment. */
export async function deleteStatement(supabase: UserClient, input: { statementId: string }): Promise<WriteResult> {
  const { error } = await supabase.rpc("delete_card_statement", { p_statement_id: input.statementId })
  if (error) return dbError(error)
  return { status: "success", message: "Statement deleted." }
}

/** "Other amount": pays the card any amount up to what it owes, not tied to a statement. */
export async function payCard(supabase: UserClient, input: FormInput): Promise<CardWriteResult> {
  const ctx = await loadCardContext(supabase, input.cardId ?? "")
  if (!ctx.ok) return { status: "error", message: ctx.message }
  const parsed = cardPaymentFormSchema(ctx.data).safeParse(input)
  if (!parsed.success) return formError(parsed.error)
  const p = parsed.data
  const { data, error } = await supabase.rpc("pay_card", {
    p_card_id: p.cardId,
    p_idempotency_key: p.idempotencyKey,
    p_account_id: p.accountId,
    p_paid_on: p.paidOn,
    p_amount_minor: p.amountMinor,
    p_allow_shortfall: p.allowShortfall,
  })
  if (error || !data) {
    return dbError(error ?? {}, { subject: "card", currency: ctx.data.currency, accountName: ctx.data.accounts.find((a) => a.id === p.accountId)?.name })
  }
  return { status: "success", message: "Card payment saved.", id: data.id }
}

// ---------------------------------------------------------------------------
// Borrowing
// ---------------------------------------------------------------------------

export async function addBorrowing(supabase: UserClient, input: FormInput): Promise<CardWriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return { status: "error", message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const [currency, paying] = await Promise.all([profileCurrency(supabase, day.userId), payingAccounts(supabase)])
  if (!currency || !paying) return { status: "error", message: UNAVAILABLE }
  const parsed = borrowingFormSchema({ today: day.today, currency, accounts: paying.accounts }).safeParse(input)
  if (!parsed.success) return formError(parsed.error)
  const b = parsed.data
  const { data, error } = await supabase.rpc("create_borrowing", {
    p_idempotency_key: b.idempotencyKey,
    p_lender: b.lender,
    p_amount_minor: b.amountMinor,
    p_relationship: b.relationship,
    p_reason: b.reason ?? undefined,
    p_amount_to_return_minor: b.amountToReturnMinor,
    p_received_account_id: b.accountId ?? undefined,
    p_received_on: b.receivedOn ?? undefined,
    p_return_on: b.returnOn ?? undefined,
    p_return_plan: b.returnPlan ?? undefined,
    p_instalment_count: b.instalmentCount ?? undefined,
    p_pay_from_account_id: b.payFromAccountId ?? undefined,
  })
  if (error || !data) return dbError(error ?? {}, { subject: "borrowing", currency })
  return { status: "success", message: "Borrowing added.", id: data.id }
}

export async function editBorrowing(supabase: UserClient, input: FormInput): Promise<CardWriteResult> {
  const parsed = borrowingEditFormSchema().safeParse(input)
  if (!parsed.success) return formError(parsed.error)
  const b = parsed.data
  const { error } = await supabase.rpc("update_borrowing", {
    p_borrowing_id: b.borrowingId,
    p_lender: b.lender,
    p_relationship: b.relationship,
    p_reason: b.reason ?? undefined,
  })
  if (error) return dbError(error, { subject: "borrowing" })
  return { status: "success", message: "Borrowing saved.", id: b.borrowingId }
}

/**
 * Sets how much to return and the return plan (once, or monthly instalments from a chosen
 * account), or removes it (empty return date). The due items are rebuilt; repayments so far
 * still count, first in first out. Nothing is paid by itself.
 */
export async function setBorrowingReturnPlan(supabase: UserClient, input: FormInput): Promise<WriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return { status: "error", message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const [{ data: borrowing, error }, paying] = await Promise.all([
    supabase.from("borrowings").select("id, currency, borrowed_minor, return_on").eq("id", input.borrowingId ?? "").maybeSingle(),
    payingAccounts(supabase),
  ])
  if (error || !paying) return { status: "error", message: UNAVAILABLE }
  if (!borrowing) return { status: "error", message: BORROWING_NOT_FOUND }
  const parsed = borrowingReturnPlanFormSchema({
    today: day.today,
    currency: borrowing.currency,
    borrowedMinor: borrowing.borrowed_minor,
    currentReturnOn: borrowing.return_on,
    accounts: paying.accounts,
  }).safeParse(input)
  if (!parsed.success) return formError(parsed.error)
  const p = parsed.data
  const { error: rpcError } = await supabase.rpc("set_borrowing_return_plan", {
    p_borrowing_id: p.borrowingId,
    p_amount_to_return_minor: p.amountToReturnMinor,
    p_return_on: p.returnOn ?? undefined,
    p_return_plan: p.returnPlan ?? undefined,
    p_instalment_count: p.instalmentCount ?? undefined,
    p_pay_from_account_id: p.payFromAccountId ?? undefined,
  })
  if (rpcError) return dbError(rpcError, { subject: "borrowing", currency: borrowing.currency })
  return { status: "success", message: p.returnOn ? "Return plan saved." : "Return date removed." }
}

export async function setBorrowingArchived(supabase: UserClient, input: { borrowingId: string; archived: boolean; currency?: string }): Promise<CardWriteResult> {
  const { error } = await supabase.rpc("set_borrowing_archived", { p_borrowing_id: input.borrowingId, p_archived: input.archived })
  if (error) return dbError(error, { subject: "borrowing", currency: input.currency })
  return { status: "success", message: input.archived ? "Borrowing archived." : "Borrowing restored.", id: input.borrowingId }
}

/** Deletes a borrowing that was never repaid, with the money-received entry (it can't be undone). */
export async function deleteBorrowing(supabase: UserClient, input: { borrowingId: string }): Promise<WriteResult> {
  const { error } = await supabase.rpc("delete_borrowing", { p_borrowing_id: input.borrowingId })
  if (error) return dbError(error, { subject: "borrowing" })
  return { status: "success", message: "Borrowing deleted." }
}

export type BorrowingContext = {
  today: string
  currency: string
  borrowingId: string
  accountId: string
  /** The borrowing account's opening date: received on, or the day it was added. */
  openedOn: string
  owedMinor: number
  accounts: PayingAccount[]
}

export async function loadBorrowingContext(supabase: UserClient, borrowingId: string): Promise<{ ok: true; data: BorrowingContext } | { ok: false; message: string }> {
  const day = await userToday(supabase)
  if (!day.ok) return { ok: false, message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const { data: borrowing, error } = await supabase.from("borrowings").select("id, account_id, currency").eq("id", borrowingId).maybeSingle()
  if (error) return { ok: false, message: UNAVAILABLE }
  if (!borrowing) return { ok: false, message: BORROWING_NOT_FOUND }
  const [account, paying] = await Promise.all([
    supabase.from("accounts").select("opening_balance_date").eq("id", borrowing.account_id).maybeSingle(),
    payingAccounts(supabase, [borrowing.account_id]),
  ])
  if (account.error || !account.data || !paying) return { ok: false, message: UNAVAILABLE }
  return {
    ok: true,
    data: {
      today: day.today,
      currency: borrowing.currency,
      borrowingId: borrowing.id,
      accountId: borrowing.account_id,
      openedOn: account.data.opening_balance_date,
      owedMinor: outstandingFromBalance(paying.balances.get(borrowing.account_id) ?? 0),
      accounts: paying.accounts,
    },
  }
}

/** A part or full repayment, with optional interest (an expense). */
export async function repayBorrowing(supabase: UserClient, input: FormInput): Promise<CardWriteResult> {
  const ctx = await loadBorrowingContext(supabase, input.borrowingId ?? "")
  if (!ctx.ok) return { status: "error", message: ctx.message }
  const parsed = repaymentFormSchema(ctx.data).safeParse(input)
  if (!parsed.success) return formError(parsed.error)
  const p = parsed.data
  const { data, error } = await supabase.rpc("repay_borrowing", {
    p_borrowing_id: p.borrowingId,
    p_idempotency_key: p.idempotencyKey,
    p_account_id: p.accountId,
    p_paid_on: p.paidOn,
    p_principal_minor: p.principalMinor,
    p_interest_minor: p.interestMinor,
    p_allow_shortfall: p.allowShortfall,
  })
  if (error || !data) {
    return dbError(error ?? {}, { subject: "borrowing", currency: ctx.data.currency, accountName: ctx.data.accounts.find((a) => a.id === p.accountId)?.name })
  }
  return { status: "success", message: "Repayment saved.", id: data.id }
}

// ---------------------------------------------------------------------------
// Editing and voiding a card payment or repayment
// ---------------------------------------------------------------------------

/**
 * Changes a card payment's or repayment's account, date or amounts: its entries are voided
 * and posted again, together. The checks run as if the old payment were already undone.
 */
export async function editLiabilityPayment(supabase: UserClient, input: FormInput): Promise<CardWriteResult> {
  const { data: payment, error: paymentError } = await supabase
    .from("liability_payments")
    .select("id, liability_account_id, account_id, principal_minor, interest_minor")
    .eq("id", input.paymentId ?? "")
    .is("voided_at", null)
    .maybeSingle()
  if (paymentError) return { status: "error", message: UNAVAILABLE }
  if (!payment) return { status: "error", message: PAYMENT_NOT_FOUND }
  const [card, borrowing] = await Promise.all([
    supabase.from("credit_cards").select("id").eq("account_id", payment.liability_account_id).maybeSingle(),
    supabase.from("borrowings").select("id").eq("account_id", payment.liability_account_id).maybeSingle(),
  ])
  if (card.error || borrowing.error) return { status: "error", message: UNAVAILABLE }
  const back = (accounts: PayingAccount[]) =>
    accounts.map((a) => (a.id === payment.account_id ? { ...a, balanceMinor: a.balanceMinor + payment.principal_minor + payment.interest_minor } : a))

  let args: { principal: number; interest: number; accountId: string; paidOn: string; allowShortfall: boolean; idempotencyKey: string }
  let errCtx: CardErrorContext
  if (card.data) {
    const ctx = await loadCardContext(supabase, card.data.id)
    if (!ctx.ok) return { status: "error", message: ctx.message }
    const data = { ...ctx.data, owedMinor: ctx.data.owedMinor + payment.principal_minor, accounts: back(ctx.data.accounts) }
    const parsed = cardPaymentFormSchema(data).safeParse({ ...input, cardId: card.data.id })
    if (!parsed.success) return formError(parsed.error)
    args = { ...parsed.data, principal: parsed.data.amountMinor, interest: 0 }
    errCtx = { subject: "card", currency: data.currency, accountName: data.accounts.find((a) => a.id === parsed.data.accountId)?.name }
  } else if (borrowing.data) {
    const ctx = await loadBorrowingContext(supabase, borrowing.data.id)
    if (!ctx.ok) return { status: "error", message: ctx.message }
    const data = { ...ctx.data, owedMinor: ctx.data.owedMinor + payment.principal_minor, accounts: back(ctx.data.accounts) }
    const parsed = repaymentFormSchema(data).safeParse({ ...input, borrowingId: borrowing.data.id })
    if (!parsed.success) return formError(parsed.error)
    args = { ...parsed.data, principal: parsed.data.principalMinor, interest: parsed.data.interestMinor }
    errCtx = { subject: "borrowing", currency: data.currency, accountName: data.accounts.find((a) => a.id === parsed.data.accountId)?.name }
  } else {
    return { status: "error", message: PAYMENT_NOT_FOUND }
  }

  const { data: saved, error } = await supabase.rpc("edit_liability_payment", {
    p_payment_id: payment.id,
    p_idempotency_key: args.idempotencyKey,
    p_account_id: args.accountId,
    p_paid_on: args.paidOn,
    p_principal_minor: args.principal,
    p_interest_minor: args.interest,
    p_allow_shortfall: args.allowShortfall,
  })
  if (error || !saved) return dbError(error ?? {}, errCtx)
  return { status: "success", message: "Payment saved.", id: saved.id }
}

/** Voids a card payment or repayment and its entries. */
export async function voidLiabilityPayment(
  supabase: UserClient,
  input: { paymentId: string; idempotencyKey: string; reason?: string; subject?: "card" | "borrowing" },
): Promise<CardWriteResult> {
  const { data, error } = await supabase.rpc("void_liability_payment", {
    p_payment_id: input.paymentId,
    p_idempotency_key: input.idempotencyKey,
    p_reason: input.reason?.trim() || undefined,
  })
  if (error || !data) return dbError(error ?? {}, { subject: input.subject })
  return { status: "success", message: "Payment voided.", id: data.id }
}
