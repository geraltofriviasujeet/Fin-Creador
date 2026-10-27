import { firstFieldErrors, fixedDepositFormSchema } from "@fin-creador/schemas"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "../income/client"
import type { WriteResult } from "../income/types"
import type { FormInput } from "../income/writers"
import { ledgerErrorMessage } from "../ledger-errors"

// Writes for fixed deposits, shared by web and mobile. They run as the signed-in user (RLS,
// column grants and the trigger of migration 20261027200000 apply). Edit in place; archive,
// restore and permanent delete (archived deposits only) follow the goals pattern.

const FIX_FIELDS = "Please fix the highlighted fields."
const SIGNED_OUT = "Your session has ended. Please sign in again."
const NOT_FOUND = "We couldn't find that fixed deposit. Reload and try again."

export type FixedDepositWriteResult = (WriteResult & { status: "error" }) | { status: "success"; message: string; depositId: string }

function dbError(error: { code?: string; message?: string }): WriteResult & { status: "error" } {
  const m = ledgerErrorMessage(error)
  return m.field ? { status: "error", message: FIX_FIELDS, fieldErrors: { [m.field]: m.message } } : { status: "error", message: m.message }
}

const isDuplicateKey = (error: { code?: string; message?: string }) =>
  error.code === "23505" && (error.message ?? "").includes("fixed_deposits_idempotency_unique")

/**
 * Adds a deposit (no `depositId`; once per request key: a repeated submit returns the deposit
 * the first one created) or edits one in place (`depositId`).
 */
export async function saveFixedDeposit(supabase: UserClient, input: FormInput): Promise<FixedDepositWriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return { status: "error", message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const parsed = fixedDepositFormSchema({ today: day.today }).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const d = parsed.data
  const fields = {
    bank: d.bank,
    label: d.label,
    principal_minor: d.principalMinor,
    rate_bps: d.rateBps,
    compounding: d.compounding,
    start_date: d.startDate,
    maturity_date: d.maturityDate,
  }

  if (d.depositId) {
    const { data, error } = await supabase.from("fixed_deposits").update(fields).eq("id", d.depositId).select("id")
    if (error) return dbError(error)
    if (!data?.length) return { status: "error", message: NOT_FOUND }
    return { status: "success", message: "Fixed deposit saved.", depositId: d.depositId }
  }

  const { data, error } = await supabase
    .from("fixed_deposits")
    .insert({ ...fields, idempotency_key: d.idempotencyKey! })
    .select("id")
    .single()
  if (error && isDuplicateKey(error)) {
    // The first submit already added it: answer with that deposit instead of an error.
    const { data: first } = await supabase.from("fixed_deposits").select("id").eq("idempotency_key", d.idempotencyKey!).maybeSingle()
    if (first) return { status: "success", message: "Fixed deposit added.", depositId: first.id }
  }
  if (error || !data) return dbError(error ?? {})
  return { status: "success", message: "Fixed deposit added.", depositId: data.id }
}

/** Archive (kept, out of the totals) or restore a deposit. The database stamps the time. */
export async function setFixedDepositArchived(supabase: UserClient, input: { depositId: string; archived: boolean }): Promise<FixedDepositWriteResult> {
  const { data, error } = await supabase
    .from("fixed_deposits")
    .update({ archived_at: input.archived ? new Date().toISOString() : null })
    .eq("id", input.depositId)
    .select("id")
  if (error) return dbError(error)
  if (!data?.length) return { status: "error", message: NOT_FOUND }
  return { status: "success", message: input.archived ? "Fixed deposit archived." : "Fixed deposit restored.", depositId: input.depositId }
}

/**
 * Deletes an archived deposit permanently (it can't be undone). The database allows it only
 * for the owner's archived deposits; an active one matches no row and is reported as such.
 */
export async function deleteFixedDeposit(supabase: UserClient, input: { depositId: string }): Promise<WriteResult> {
  const { data, error } = await supabase.from("fixed_deposits").delete().eq("id", input.depositId).not("archived_at", "is", null).select("id")
  if (error) return dbError(error)
  if (!data?.length) return { status: "error", message: "Only an archived fixed deposit can be deleted. Reload and try again." }
  return { status: "success", message: "Fixed deposit deleted." }
}
