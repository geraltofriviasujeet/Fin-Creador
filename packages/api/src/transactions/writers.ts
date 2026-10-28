import { firstFieldErrors, transactionFormSchema, voidFormSchema } from "@fin-creador/schemas"
import { ledgerErrorMessage } from "../ledger-errors"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "../income/client"
import type { WriteResult } from "../income/types"
import type { FormInput } from "../income/writers"

// Writes for income, expense and transfer entries, shared by web and mobile. Each one
// validates with the shared schema, writes through a database function as the signed-in
// user (RLS, column grants and triggers enforce ownership and the money rules) under the
// form's request key, so a retry saves once.

const FIX_FIELDS = "Please fix the highlighted fields."
const SIGNED_OUT = "Your session has ended. Please sign in again."
const NOUN = { income: "Income", expense: "Expense", transfer: "Transfer" } as const

function dbError(error: { code?: string; message?: string }): WriteResult {
  // FC006's shared message names the income form's source field; here it is categoryId.
  if (error.code === "FC006") {
    return { status: "error", message: FIX_FIELDS, fieldErrors: { categoryId: "That category can't be used. Choose another." } }
  }
  const m = ledgerErrorMessage(error, { dateField: "occurredOn" })
  return m.field ? { status: "error", message: FIX_FIELDS, fieldErrors: { [m.field]: m.message } } : { status: "error", message: m.message }
}

/**
 * Adds an entry (no `transactionId`) or saves an edit of the version `transactionId`
 * (the type comes from that version; a stale version is refused). The amount is parsed
 * in the "from" account's currency.
 */
export async function saveTransaction(supabase: UserClient, input: FormInput): Promise<WriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return { status: "error", message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }

  const { data: account } = input.accountId
    ? await supabase.from("accounts").select("currency, kind").eq("id", input.accountId).maybeSingle()
    : { data: null }

  const parsed = transactionFormSchema({
    today: day.today,
    currency: account?.currency ?? "INR",
    accountKind: (account?.kind as "bank" | "cash" | "other" | "card" | undefined) ?? null,
  }).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  if (!account) return { status: "error", message: FIX_FIELDS, fieldErrors: { accountId: "Choose an account" } }

  const t = parsed.data
  const details = {
    p_idempotency_key: t.idempotencyKey,
    p_amount_minor: t.amountMinor,
    p_occurred_on: t.occurredOn,
    p_account_id: t.accountId,
    p_category_id: t.categoryId ?? undefined,
    p_counter_account_id: t.counterAccountId ?? undefined,
    p_note: t.note ?? undefined,
    p_payment_mode: t.paymentMode ?? undefined,
  }
  const { error } = t.transactionId
    ? await supabase.rpc("edit_transaction", { p_transaction_id: t.transactionId, ...details })
    : await supabase.rpc("record_transaction", { p_type: t.type, ...details })
  if (error) return dbError(error)
  return { status: "success", message: t.transactionId ? "Changes saved." : `${NOUN[t.type]} saved.` }
}

/** One-way void under the form's request key: the entry stays in history and stops counting. */
export async function voidTransaction(supabase: UserClient, input: FormInput): Promise<WriteResult> {
  const parsed = voidFormSchema.safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const { data, error } = await supabase.rpc("void_transaction", {
    p_transaction_id: parsed.data.transactionId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_reason: parsed.data.reason ?? undefined,
  })
  if (error || !data) return dbError(error ?? {})
  return { status: "success", message: `${NOUN[data.type as keyof typeof NOUN] ?? "Entry"} voided.` }
}
