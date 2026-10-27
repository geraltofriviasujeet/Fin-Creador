import { firstFieldErrors, holdingFormSchema } from "@fin-creador/schemas"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "../income/client"
import type { WriteResult } from "../income/types"
import type { FormInput } from "../income/writers"
import { ledgerErrorMessage } from "../ledger-errors"

// Writes for investment holding records, shared by web and mobile. They run as the signed-in
// user (RLS, column grants and the triggers of migration 20261027120000 apply). Archive,
// restore and permanent delete (archived records only) follow the goals pattern.

const FIX_FIELDS = "Please fix the highlighted fields."
const SIGNED_OUT = "Your session has ended. Please sign in again."
const NOT_FOUND = "We couldn't find that holding. Reload and try again."

export type HoldingWriteResult = (WriteResult & { status: "error" }) | { status: "success"; message: string; holdingId: string }

function dbError(error: { code?: string; message?: string }): WriteResult & { status: "error" } {
  const m = ledgerErrorMessage(error)
  return m.field ? { status: "error", message: FIX_FIELDS, fieldErrors: { [m.field]: m.message } } : { status: "error", message: m.message }
}

const isDuplicateKey = (error: { code?: string; message?: string }) =>
  error.code === "23505" && (error.message ?? "").includes("investments_idempotency_unique")

/**
 * Adds a record (no `holdingId`; once per request key: a repeated submit returns the record
 * the first one created) or edits one in place (`holdingId`; the instrument never changes).
 */
export async function saveHolding(supabase: UserClient, input: FormInput): Promise<HoldingWriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return { status: "error", message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const parsed = holdingFormSchema({ today: day.today }).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const h = parsed.data
  const fields = { units_scaled: h.unitsScaled, buy_price_scaled: h.buyPriceScaled, buy_date: h.buyDate }

  if (h.holdingId) {
    const { data, error } = await supabase.from("investments").update(fields).eq("id", h.holdingId).select("id")
    if (error) return dbError(error)
    if (!data?.length) return { status: "error", message: NOT_FOUND }
    return { status: "success", message: "Holding saved.", holdingId: h.holdingId }
  }

  const { data, error } = await supabase
    .from("investments")
    // No isin_at_entry: the database copies it from the instrument.
    .insert({ ...fields, instrument_id: h.instrumentId!, idempotency_key: h.idempotencyKey! })
    .select("id")
    .single()
  if (error && isDuplicateKey(error)) {
    // The first submit already added it: answer with that record instead of an error.
    const { data: first } = await supabase.from("investments").select("id").eq("idempotency_key", h.idempotencyKey!).maybeSingle()
    if (first) return { status: "success", message: "Holding added.", holdingId: first.id }
  }
  if (error || !data) return dbError(error ?? {})
  return { status: "success", message: "Holding added.", holdingId: data.id }
}

/** Archive (kept, out of the totals) or restore a record. The database stamps the time. */
export async function setHoldingArchived(supabase: UserClient, input: { holdingId: string; archived: boolean }): Promise<HoldingWriteResult> {
  const { data, error } = await supabase
    .from("investments")
    .update({ archived_at: input.archived ? new Date().toISOString() : null })
    .eq("id", input.holdingId)
    .select("id")
  if (error) return dbError(error)
  if (!data?.length) return { status: "error", message: NOT_FOUND }
  return { status: "success", message: input.archived ? "Holding archived." : "Holding restored.", holdingId: input.holdingId }
}

/**
 * Deletes an archived record permanently (it can't be undone). The database allows it only
 * for the owner's archived records; an active record matches no row and is reported as such.
 */
export async function deleteHolding(supabase: UserClient, input: { holdingId: string }): Promise<WriteResult> {
  const { data, error } = await supabase.from("investments").delete().eq("id", input.holdingId).not("archived_at", "is", null).select("id")
  if (error) return dbError(error)
  if (!data?.length) return { status: "error", message: "Only an archived holding can be deleted. Reload and try again." }
  return { status: "success", message: "Holding deleted." }
}
