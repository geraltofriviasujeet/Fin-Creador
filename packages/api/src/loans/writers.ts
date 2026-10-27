import { MONEY_ACCOUNT_KINDS, outstandingFromBalance } from "@fin-creador/domain"
import {
  type PayingAccount,
  firstFieldErrors,
  loanEditFormSchema,
  loanFormSchema,
  payDueFormSchema,
  planDueFormSchema,
} from "@fin-creador/schemas"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "../income/client"
import type { WriteResult } from "../income/types"
import type { FormInput } from "../income/writers"
import { type LoanErrorContext, loanErrorMessage } from "./errors"

// Writes for loans and their due items, shared by web and mobile. They run as the signed-in
// user through the SECURITY INVOKER functions of migration 20261028120000 (RLS and grants
// apply; the database refuses any direct write). Every add and payment carries a request key.

const FIX_FIELDS = "Please fix the highlighted fields."
const SIGNED_OUT = "Your session has ended. Please sign in again."
const NOT_FOUND = "We couldn't find that loan. Reload and try again."
const DUE_NOT_FOUND = "We couldn't find that EMI. Reload and try again."
const UNAVAILABLE = "We couldn't load your accounts. Check your connection and try again."

export type LoanWriteError = WriteResult & {
  status: "error"
  /** FC035 or the form's own check: the account is short; offer "Pay anyway". */
  shortfallMinor?: number
}
export type LoanWriteResult = LoanWriteError | { status: "success"; message: string; loanId: string }
export type PaymentWriteResult = LoanWriteError | { status: "success"; message: string; paymentId: string }

function dbError(error: { code?: string; message?: string; details?: string | null }, ctx: LoanErrorContext = {}): LoanWriteError {
  const m = loanErrorMessage(error, ctx)
  const base: LoanWriteError = m.field ? { status: "error", message: FIX_FIELDS, fieldErrors: { [m.field]: m.message } } : { status: "error", message: m.message }
  return m.shortfallMinor ? { ...base, shortfallMinor: m.shortfallMinor } : base
}

async function profileCurrency(supabase: UserClient, userId: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("currency").eq("id", userId).maybeSingle()
  return data?.currency ?? null
}

/** Adds a loan once per request key (a repeated submit returns the loan the first one added). */
export async function addLoan(supabase: UserClient, input: FormInput): Promise<LoanWriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return { status: "error", message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const currency = await profileCurrency(supabase, day.userId)
  if (!currency) return { status: "error", message: UNAVAILABLE }
  const parsed = loanFormSchema({ today: day.today, currency }).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const l = parsed.data
  const { data, error } = await supabase
    .rpc("create_loan", {
      p_idempotency_key: l.idempotencyKey,
      p_loan_type: l.loanType,
      p_lender: l.lender,
      p_sanctioned_minor: l.sanctionedMinor,
      p_disbursed_minor: l.disbursedMinor,
      p_rate_bps: l.rateBps,
      p_rate_kind: l.rateKind,
      p_tenure_months: l.tenureMonths,
      p_start_mode: l.startMode,
      p_outstanding_minor: l.outstandingMinor,
      p_instalment_months: l.remainingMonths,
      p_first_due_date: l.firstDueDate,
      p_emi_estimate_minor: l.emiEstimateMinor,
      p_emi_minor: l.emiMinor,
      p_type_other: l.typeOther ?? undefined,
      p_nickname: l.nickname ?? undefined,
      p_before_tracking_on: l.beforeTrackingOn ?? undefined,
      p_moratorium_months: l.moratoriumMonths,
      p_moratorium_interest: l.moratoriumInterest ?? undefined,
      p_capitalised_minor: l.capitalisedMinor,
      p_moratorium_interest_minor: l.moratoriumMonthlyInterestMinor,
    })
  if (error || !data) return dbError(error ?? {})
  return { status: "success", message: "Loan added.", loanId: data.id }
}

/** Edits names, sanctioned amount, rate and EMI. A new EMI applies to pending EMIs. */
export async function editLoan(supabase: UserClient, input: FormInput): Promise<LoanWriteResult> {
  const { data: loan, error: loanError } = await supabase
    .from("loans")
    .select("id, account_id, currency, disbursed_minor")
    .eq("id", input.loanId ?? "")
    .maybeSingle()
  if (loanError) return { status: "error", message: UNAVAILABLE }
  if (!loan) return { status: "error", message: NOT_FOUND }
  const [balance, pending] = await Promise.all([
    accountBalances(supabase, [loan.account_id]),
    supabase.from("due_items").select("id").eq("loan_id", loan.id).eq("kind", "loan_emi").eq("status", "pending"),
  ])
  if (!balance || pending.error) return { status: "error", message: UNAVAILABLE }
  const parsed = loanEditFormSchema({
    currency: loan.currency,
    loan: { disbursedMinor: loan.disbursed_minor, outstandingMinor: outstandingFromBalance(balance.get(loan.account_id) ?? 0), pendingEmis: pending.data.length },
  }).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const l = parsed.data
  const { error } = await supabase
    .rpc("update_loan", {
      p_loan_id: l.loanId,
      p_loan_type: l.loanType,
      p_lender: l.lender,
      p_sanctioned_minor: l.sanctionedMinor,
      p_rate_bps: l.rateBps,
      p_rate_kind: l.rateKind,
      p_emi_minor: l.emiMinor,
      p_type_other: l.typeOther ?? undefined,
      p_nickname: l.nickname ?? undefined,
    })
  if (error) return dbError(error)
  return { status: "success", message: "Loan saved.", loanId: l.loanId }
}

/** Archive (hidden, no reminders, no payments) or restore a loan with its account. */
export async function setLoanArchived(supabase: UserClient, input: { loanId: string; archived: boolean }): Promise<LoanWriteResult> {
  const { error } = await supabase.rpc("set_loan_archived", { p_loan_id: input.loanId, p_archived: input.archived })
  if (error) return dbError(error)
  return { status: "success", message: input.archived ? "Loan archived." : "Loan restored.", loanId: input.loanId }
}

/** Deletes an archived loan that never had a payment (it can't be undone). */
export async function deleteLoan(supabase: UserClient, input: { loanId: string }): Promise<WriteResult> {
  const { error } = await supabase.rpc("delete_loan", { p_loan_id: input.loanId })
  if (error) return dbError(error)
  return { status: "success", message: "Loan deleted." }
}

// ---------------------------------------------------------------------------
// Paying a due item
// ---------------------------------------------------------------------------

/** Balance per account (opening + posted inflows − posted outflows), or null when unavailable. */
async function accountBalances(supabase: UserClient, ids: string[]): Promise<Map<string, number> | null> {
  const [accounts, sums] = await Promise.all([
    supabase.from("accounts").select("id, opening_balance_minor").in("id", ids),
    supabase.from("account_balances").select("account_id, inflow_minor, outflow_minor").in("account_id", ids),
  ])
  if (accounts.error || sums.error) return null
  const byId = new Map(sums.data.map((b) => [b.account_id, b]))
  return new Map(accounts.data.map((a) => [a.id, a.opening_balance_minor + (byId.get(a.id)?.inflow_minor ?? 0) - (byId.get(a.id)?.outflow_minor ?? 0)]))
}

export type PaymentContext = {
  today: string
  currency: string
  trackingStartedOn: string
  /** Owed on the loan, including moratorium interest the next EMI paid will add. */
  outstandingMinor: number
  /** Active bank, cash and other accounts, with balances. */
  accounts: PayingAccount[]
}

/** What the pay and plan forms check against, read as the signed-in user. */
export async function loadPaymentContext(supabase: UserClient, dueItemId: string): Promise<{ ok: true; data: PaymentContext } | { ok: false; message: string }> {
  const day = await userToday(supabase)
  if (!day.ok) return { ok: false, message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const { data: item, error } = await supabase.from("due_items").select("id, kind, loan_id, currency").eq("id", dueItemId).maybeSingle()
  if (error) return { ok: false, message: UNAVAILABLE }
  if (!item?.loan_id) return { ok: false, message: DUE_NOT_FOUND }
  const [loanRes, accountsRes, itemsRes] = await Promise.all([
    supabase.from("loans").select("account_id, tracking_started_on, moratorium_interest, capitalised_minor").eq("id", item.loan_id).maybeSingle(),
    supabase
      .from("accounts")
      .select("id, name, last4, currency, opening_balance_date")
      .in("kind", [...MONEY_ACCOUNT_KINDS])
      .is("archived_at", null)
      .order("created_at"),
    supabase.from("due_items").select("id").eq("loan_id", item.loan_id),
  ])
  if (loanRes.error || accountsRes.error || itemsRes.error || !loanRes.data) return { ok: false, message: UNAVAILABLE }
  // Moratorium interest is added with the first EMI paid: is it already on this loan?
  const capRes = await supabase
    .from("due_payments")
    .select("id")
    .in("due_item_id", itemsRes.data.map((d) => d.id))
    .is("voided_at", null)
    .gt("capitalised_minor", 0)
    .limit(1)
  if (capRes.error) return { ok: false, message: UNAVAILABLE }
  const loan = loanRes.data
  const balances = await accountBalances(supabase, [loan.account_id, ...accountsRes.data.map((a) => a.id)])
  if (!balances) return { ok: false, message: UNAVAILABLE }
  const pendingCap =
    item.kind === "loan_emi" && loan.moratorium_interest === "capitalise" && loan.capitalised_minor > 0 && capRes.data.length === 0 ? loan.capitalised_minor : 0
  return {
    ok: true,
    data: {
      today: day.today,
      currency: item.currency,
      trackingStartedOn: loan.tracking_started_on,
      outstandingMinor: outstandingFromBalance(balances.get(loan.account_id) ?? 0) + pendingCap,
      accounts: accountsRes.data.map((a) => ({
        id: a.id,
        name: a.last4 ? `${a.name} ··${a.last4}` : a.name,
        currency: a.currency,
        balanceMinor: balances.get(a.id) ?? 0,
        openingBalanceDate: a.opening_balance_date,
      })),
    },
  }
}

/**
 * "Paid": posts the EMI from the chosen account once per request key. When the account is
 * short the result carries `shortfallMinor`; sending the same input again with
 * `allowShortfall: "true"` ("Pay anyway") pays it.
 */
export async function payDueItem(supabase: UserClient, input: FormInput): Promise<PaymentWriteResult> {
  const ctx = await loadPaymentContext(supabase, input.dueItemId ?? "")
  if (!ctx.ok) return { status: "error", message: ctx.message }
  const parsed = payDueFormSchema(ctx.data).safeParse(input)
  if (!parsed.success) return formError(parsed.error)
  const p = parsed.data
  const { data, error } = await supabase
    .rpc("pay_due_item", {
      p_due_item_id: p.dueItemId,
      p_idempotency_key: p.idempotencyKey,
      p_account_id: p.accountId,
      p_paid_on: p.paidOn,
      p_principal_minor: p.principalMinor,
      p_interest_minor: p.interestMinor,
      p_fees_minor: p.feesMinor,
      p_allow_shortfall: p.allowShortfall,
    })
  if (error || !data) return dbError(error ?? {}, { currency: ctx.data.currency, accountName: ctx.data.accounts.find((a) => a.id === p.accountId)?.name })
  return { status: "success", message: "EMI paid.", paymentId: data.id }
}

/** Changes a payment's account, date or split: every part is voided and posted again, together. */
export async function editDuePayment(supabase: UserClient, input: FormInput): Promise<PaymentWriteResult> {
  const { data: payment, error: paymentError } = await supabase
    .from("due_payments")
    .select("id, due_item_id, account_id, principal_minor, interest_minor, fees_minor")
    .eq("id", input.paymentId ?? "")
    .is("voided_at", null)
    .maybeSingle()
  if (paymentError) return { status: "error", message: UNAVAILABLE }
  if (!payment) return { status: "error", message: "We couldn't find that payment. Reload and try again." }
  const ctx = await loadPaymentContext(supabase, payment.due_item_id)
  if (!ctx.ok) return { status: "error", message: ctx.message }
  // The payment being replaced is voided first: its principal is owed again, and its total is
  // back in its account, before the new split is checked.
  const oldTotal = payment.principal_minor + payment.interest_minor + payment.fees_minor
  const data: PaymentContext = {
    ...ctx.data,
    outstandingMinor: ctx.data.outstandingMinor + payment.principal_minor,
    accounts: ctx.data.accounts.map((a) => (a.id === payment.account_id ? { ...a, balanceMinor: a.balanceMinor + oldTotal } : a)),
  }
  const parsed = payDueFormSchema(data).safeParse({ ...input, dueItemId: payment.due_item_id })
  if (!parsed.success) return formError(parsed.error)
  const p = parsed.data
  const { data: saved, error } = await supabase
    .rpc("edit_due_payment", {
      p_payment_id: payment.id,
      p_idempotency_key: p.idempotencyKey,
      p_account_id: p.accountId,
      p_paid_on: p.paidOn,
      p_principal_minor: p.principalMinor,
      p_interest_minor: p.interestMinor,
      p_fees_minor: p.feesMinor,
      p_allow_shortfall: p.allowShortfall,
    })
  if (error || !saved) return dbError(error ?? {}, { currency: data.currency, accountName: data.accounts.find((a) => a.id === p.accountId)?.name })
  return { status: "success", message: "Payment saved.", paymentId: saved.id }
}

/** Voids a payment and every entry it posted; the EMI is pending again. */
export async function voidDuePayment(supabase: UserClient, input: { paymentId: string; idempotencyKey: string; reason?: string }): Promise<PaymentWriteResult> {
  const { data, error } = await supabase
    .rpc("void_due_payment", { p_payment_id: input.paymentId, p_idempotency_key: input.idempotencyKey, p_reason: input.reason?.trim() || undefined })
  if (error || !data) return dbError(error ?? {})
  return { status: "success", message: "Payment voided.", paymentId: data.id }
}

/** "Will pay later": a planned date and account; the EMI stays pending. Clear it with `clearDuePlan`. */
export async function planDueItem(supabase: UserClient, input: FormInput): Promise<WriteResult> {
  const ctx = await loadPaymentContext(supabase, input.dueItemId ?? "")
  if (!ctx.ok) return { status: "error", message: ctx.message }
  const parsed = planDueFormSchema(ctx.data).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const p = parsed.data
  const { data, error } = await supabase
    .from("due_items")
    .update({ planned_on: p.plannedOn, planned_account_id: p.accountId })
    .eq("id", p.dueItemId)
    .select("id")
  if (error) return dbError(error)
  if (!data?.length) return { status: "error", message: DUE_NOT_FOUND }
  return { status: "success", message: "Planned." }
}

export async function clearDuePlan(supabase: UserClient, input: { dueItemId: string }): Promise<WriteResult> {
  const { data, error } = await supabase.from("due_items").update({ planned_on: null, planned_account_id: null }).eq("id", input.dueItemId).select("id")
  if (error) return dbError(error)
  if (!data?.length) return { status: "error", message: DUE_NOT_FOUND }
  return { status: "success", message: "Plan removed." }
}

/** A form error; a shortfall (the account can't cover it) also says how much, for "Pay anyway". */
function formError(error: Parameters<typeof firstFieldErrors>[0]): LoanWriteError {
  const result: LoanWriteError = { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(error) }
  const issue = error.issues.find((i) => i.path[0] === "accountId")
  const shortfallMinor = (issue as { params?: { shortfallMinor?: unknown } } | undefined)?.params?.shortfallMinor
  return typeof shortfallMinor === "number" ? { ...result, shortfallMinor } : result
}
