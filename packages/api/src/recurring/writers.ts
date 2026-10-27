import { confirmOccurrenceSchema, firstFieldErrors, recurringRuleFormSchema, skipOccurrenceSchema } from "@fin-creador/schemas"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "../income/client"
import type { WriteResult } from "../income/types"
import type { FormInput } from "../income/writers"
import { ledgerErrorMessage } from "../ledger-errors"

// Writes for recurring rules, shared by web and mobile. Each validates with the shared
// schema and writes through a database function as the signed-in user (RLS, grants and
// triggers apply). Adding a rule, confirming and skipping are once per request key.

const FIX_FIELDS = "Please fix the highlighted fields."
const SIGNED_OUT = "Your session has ended. Please sign in again."
const NOUN = { income: "Income", expense: "Expense", transfer: "Transfer" } as const

function dbError(error: { code?: string; message?: string }): WriteResult {
  if (error.code === "FC006") {
    return { status: "error", message: FIX_FIELDS, fieldErrors: { categoryId: "That category can't be used. Choose another." } }
  }
  const m = ledgerErrorMessage(error, { dateField: "occurredOn" })
  return m.field ? { status: "error", message: FIX_FIELDS, fieldErrors: { [m.field]: m.message } } : { status: "error", message: m.message }
}

async function accountOf(supabase: UserClient, id: string | undefined) {
  if (!id) return null
  const { data } = await supabase.from("accounts").select("currency, kind").eq("id", id).maybeSingle()
  return data ? { currency: data.currency, kind: data.kind as "bank" | "cash" | "other" | "card" } : null
}

/** Adds a rule (no `ruleId`, needs a request key) or saves an edit of one (with `ruleId`). */
export async function saveRecurringRule(supabase: UserClient, input: FormInput): Promise<WriteResult> {
  const account = await accountOf(supabase, input.accountId)
  const parsed = recurringRuleFormSchema({ currency: account?.currency ?? "INR", accountKind: account?.kind ?? null }).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  if (!account) return { status: "error", message: FIX_FIELDS, fieldErrors: { accountId: "Choose an account" } }
  const r = parsed.data

  const shared = {
    p_amount_minor: r.amountMinor,
    p_account_id: r.accountId,
    p_category_id: r.categoryId ?? undefined,
    p_counter_account_id: r.counterAccountId ?? undefined,
    p_payment_mode: r.paymentMode ?? undefined,
    p_note: r.note ?? undefined,
    p_end_date: r.endDate ?? undefined,
  }
  const { error } = r.ruleId
    ? await supabase.rpc("update_recurring_rule", { p_rule_id: r.ruleId, ...shared })
    : await supabase.rpc("create_recurring_rule", {
        p_idempotency_key: r.idempotencyKey!,
        p_type: r.type,
        p_frequency: r.frequency,
        p_start_date: r.startDate,
        ...shared,
      })
  if (error) return dbError(error)
  return { status: "success", message: r.ruleId ? "Recurring item saved." : "Recurring item added." }
}

/** Archive (stops being due; its entries stay) or restore a rule. */
export async function setRecurringRuleArchived(supabase: UserClient, input: { ruleId: string; archived: boolean }): Promise<WriteResult> {
  const { error } = await supabase.rpc("set_recurring_rule_archived", { p_rule_id: input.ruleId, p_archived: input.archived })
  if (error) return dbError(error)
  return { status: "success", message: input.archived ? "Recurring item archived." : "Recurring item restored." }
}

/**
 * Saves the entry for one occurrence, once per request key. Type and category come from the
 * rule (`type` is the rule's type, for the account checks); the database refuses a second
 * entry for the same occurrence.
 */
export async function confirmRecurringOccurrence(supabase: UserClient, input: FormInput & { type?: string }): Promise<WriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return { status: "error", message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const type = input.type === "income" || input.type === "transfer" ? input.type : "expense"
  const account = await accountOf(supabase, input.accountId)
  const parsed = confirmOccurrenceSchema({ today: day.today, currency: account?.currency ?? "INR", accountKind: account?.kind ?? null, type }).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  if (!account) return { status: "error", message: FIX_FIELDS, fieldErrors: { accountId: "Choose an account" } }
  const c = parsed.data

  const { error } = await supabase.rpc("confirm_recurring_occurrence", {
    p_rule_id: c.ruleId,
    p_occurrence_date: c.occurrenceDate,
    p_idempotency_key: c.idempotencyKey,
    p_amount_minor: c.amountMinor,
    p_occurred_on: c.occurredOn,
    p_account_id: c.accountId,
    p_counter_account_id: c.counterAccountId ?? undefined,
    p_note: c.note ?? undefined,
    p_payment_mode: c.paymentMode ?? undefined,
  })
  if (error) return dbError(error)
  return { status: "success", message: `${NOUN[type]} saved.` }
}

/** Skips one occurrence (nothing is saved), once per request key. */
export async function skipRecurringOccurrence(supabase: UserClient, input: FormInput): Promise<WriteResult> {
  const parsed = skipOccurrenceSchema.safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const { error } = await supabase.rpc("skip_recurring_occurrence", {
    p_rule_id: parsed.data.ruleId,
    p_occurrence_date: parsed.data.occurrenceDate,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_reason: parsed.data.reason ?? undefined,
  })
  if (error) return dbError(error)
  return { status: "success", message: "Skipped. Nothing was saved for this date." }
}

/** Undoes a skip; only the rule's latest handled occurrence (FC021 otherwise). */
export async function undoRecurringSkip(supabase: UserClient, input: { ruleId: string; occurrenceDate: string }): Promise<WriteResult> {
  const { error } = await supabase.rpc("undo_recurring_skip", { p_rule_id: input.ruleId, p_occurrence_date: input.occurrenceDate })
  if (error) return dbError(error)
  return { status: "success", message: "Skip undone. The date is due again." }
}
