import { AMOUNT_ERROR_MESSAGES, parseAmount } from "@fin-creador/domain"
import { accountFormSchema, firstFieldErrors, incomeFormSchema, sourceFormSchema } from "@fin-creador/schemas"
import type { z } from "zod"
import { ledgerErrorMessage } from "../ledger-errors"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "./client"
import type { WriteResult } from "./types"

// Writes for accounts, sources and income, shared by the web's server actions and the
// mobile app. Each one: validate with the shared schema, write as the signed-in user
// (RLS, column grants and database triggers enforce ownership and the money rules), and
// map database errors to friendly, field-level messages.

export type FormInput = Record<string, string | undefined>

const FIX_FIELDS = "Please fix the highlighted fields."
const SIGNED_OUT = "Your session has ended. Please sign in again."

function check<S extends z.ZodType>(schema: S, input: FormInput) {
  const result = schema.safeParse(input)
  if (result.success) return { ok: true as const, data: result.data as z.output<S> }
  return {
    ok: false as const,
    result: { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(result.error) } satisfies WriteResult,
  }
}

function dbError(error: { code?: string; message?: string }, dateField?: string): WriteResult {
  const m = ledgerErrorMessage(error, { dateField })
  return m.field
    ? { status: "error", message: FIX_FIELDS, fieldErrors: { [m.field]: m.message } }
    : { status: "error", message: m.message }
}

const notToday = (reason: "unauthenticated" | "unavailable"): WriteResult => ({
  status: "error",
  message: reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE,
})

/** Add (no `id`) or edit (with `id`) a bank, cash or other account. */
export async function saveAccount(supabase: UserClient, input: FormInput): Promise<WriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return notToday(day.reason)
  const v = check(accountFormSchema({ today: day.today }), input)
  if (!v.ok) return v.result

  const a = v.data
  const columns = {
    bank_type: a.bankType,
    name: a.name,
    institution: a.institution,
    last4: a.last4,
    currency: a.currency,
    opening_balance_minor: a.openingBalanceMinor,
    opening_balance_date: a.openingBalanceDate,
  }

  if (input.id) {
    const { data, error } = await supabase.from("accounts").update(columns).eq("id", input.id).select("id").maybeSingle()
    if (error) return dbError(error, "openingBalanceDate")
    if (!data) return { status: "error", message: "We couldn't find that account." }
    return { status: "success", message: "Account updated." }
  }

  const { error } = await supabase.from("accounts").insert({ kind: a.kind, ...columns })
  if (error) return dbError(error, "openingBalanceDate")
  return { status: "success", message: "Account added." }
}

/** Archive (leaves lists and totals, history stays) or restore an account. */
export async function setAccountArchived(supabase: UserClient, input: { id: string; archived: boolean }): Promise<WriteResult> {
  const { data, error } = await supabase
    .from("accounts")
    .update({ archived_at: input.archived ? new Date().toISOString() : null })
    .eq("id", input.id)
    .select("id")
    .maybeSingle()
  if (error || !data) return { status: "error", message: "We couldn't update that account. Please try again." }
  return { status: "success", message: input.archived ? "Account archived." : "Account restored." }
}

export async function saveSource(supabase: UserClient, input: FormInput): Promise<WriteResult> {
  const v = check(sourceFormSchema, input)
  if (!v.ok) return v.result
  const s = v.data
  const { error } = await supabase
    .from("categories")
    .insert({ kind: "income", name: s.name, source_type: s.sourceType, default_account_id: s.defaultAccountId })
  if (error) return dbError(error)
  return { status: "success", message: "Source added." }
}

/**
 * Records income once per `idempotencyKey` (record_income returns the original entry on
 * a repeat). The amount is parsed in the receiving account's currency.
 */
export async function recordIncome(supabase: UserClient, input: FormInput): Promise<WriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return notToday(day.reason)

  const { data: account } = input.accountId
    ? await supabase.from("accounts").select("currency").eq("id", input.accountId).maybeSingle()
    : { data: null }

  const v = check(incomeFormSchema({ today: day.today, currency: account?.currency ?? "INR" }), input)
  if (!v.ok) return v.result
  if (!account) return { status: "error", message: FIX_FIELDS, fieldErrors: { accountId: "Choose where it was received" } }

  const i = v.data
  const { error } = await supabase.rpc("record_income", {
    p_account_id: i.accountId,
    p_category_id: i.sourceId,
    p_amount_minor: i.amountMinor,
    p_occurred_on: i.occurredOn,
    p_idempotency_key: i.idempotencyKey,
    p_note: i.note ?? undefined,
  })
  if (error) return dbError(error, "occurredOn")
  return { status: "success", message: "Income saved." }
}

/**
 * "I have this much cash now" for the user's Cash in hand (one per user). A correction,
 * not income: the database moves the as-of date to today and sets the opening amount so
 * the balance equals `amount`; income entries are not changed.
 */
export async function updateCashOnHand(supabase: UserClient, input: { accountId?: string; amount?: string }): Promise<WriteResult> {
  const { data: account } = input.accountId
    ? await supabase.from("accounts").select("currency").eq("id", input.accountId).maybeSingle()
    : { data: null }
  if (!account) return { status: "error", message: "We couldn't find your cash account." }

  const amount = parseAmount(input.amount ?? "", account.currency, { allowZero: true })
  if (!amount.ok) {
    return { status: "error", message: FIX_FIELDS, fieldErrors: { amount: AMOUNT_ERROR_MESSAGES[amount.error] } }
  }

  const { error } = await supabase.rpc("set_cash_on_hand", { p_account_id: input.accountId!, p_amount_minor: amount.minor })
  if (error?.code === "23514") {
    return { status: "error", message: FIX_FIELDS, fieldErrors: { amount: "That's less than the cash income you recorded today." } }
  }
  if (error) return dbError(error)
  return { status: "success", message: "Cash in hand updated." }
}
