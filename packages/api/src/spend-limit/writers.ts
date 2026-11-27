import { firstFieldErrors, spendLimitFormSchema } from "@fin-creador/schemas"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "../income/client"
import type { WriteResult } from "../income/types"
import type { FormInput } from "../income/writers"
import { ledgerErrorMessage } from "../ledger-errors"

// Writes for the daily spend limit, shared by web and mobile. They run as the signed-in user:
// RLS, the column grants and the trigger of migration 20261127120000 apply. The database sets
// the currency (the profile's) and starts_on (kept when only the amount changes).

const FIX_FIELDS = "Please fix the highlighted fields."
const SIGNED_OUT = "Your session has ended. Please sign in again."

function dbError(error: { code?: string; message?: string }): WriteResult & { status: "error" } {
  const m = ledgerErrorMessage(error)
  return m.field ? { status: "error", message: FIX_FIELDS, fieldErrors: { [m.field]: m.message } } : { status: "error", message: m.message }
}

/** Sets or changes the limit (form fields: period, days for custom, amount). Repeat-safe. */
export async function saveSpendLimit(supabase: UserClient, input: FormInput): Promise<WriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return { status: "error", message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const { data: profile } = await supabase.from("profiles").select("currency").eq("id", day.userId).maybeSingle()
  const parsed = spendLimitFormSchema({ currency: profile?.currency ?? "INR" }).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const v = parsed.data
  const { error } = await supabase.rpc("set_spend_limit", {
    p_amount_minor: v.amountMinor,
    p_period: v.period,
    ...(v.periodDays === null ? {} : { p_period_days: v.periodDays }),
  })
  if (error) return dbError(error)
  return { status: "success", message: "Daily spend limit saved." }
}

/** Removes the limit. Removing when none is set is not an error (a double tap is harmless). */
export async function removeSpendLimit(supabase: UserClient): Promise<WriteResult> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { status: "error", message: SIGNED_OUT }
  const { error } = await supabase.from("spend_limits").delete().eq("user_id", auth.user.id)
  if (error) return dbError(error)
  return { status: "success", message: "Daily spend limit removed." }
}
