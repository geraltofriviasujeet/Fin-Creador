import { budgetFormSchema, firstFieldErrors, goalFormSchema, goalSavedSchema } from "@fin-creador/schemas"
import { TODAY_UNAVAILABLE, type UserClient, userToday } from "../income/client"
import type { Database, Json } from "../database.types"
import type { WriteResult } from "../income/types"
import type { FormInput } from "../income/writers"
import { ledgerErrorMessage } from "../ledger-errors"

// Writes for goals (planned expenses) and monthly budgets, shared by web and mobile. They
// run as the signed-in user (RLS, column grants and the triggers of migration
// 20261026180000 apply). The target amount is never taken from the client: every goal
// write recomputes it from the answers (goalFormSchema → goalFigures).

const FIX_FIELDS = "Please fix the highlighted fields."
const SIGNED_OUT = "Your session has ended. Please sign in again."
const NOT_FOUND = "We couldn't find that goal. Reload and try again."

export type GoalWriteResult = (WriteResult & { status: "error" }) | { status: "success"; message: string; goalId: string }

function dbError(error: { code?: string; message?: string }): WriteResult & { status: "error" } {
  const m = ledgerErrorMessage(error)
  return m.field ? { status: "error", message: FIX_FIELDS, fieldErrors: { [m.field]: m.message } } : { status: "error", message: m.message }
}

const isDuplicateKey = (error: { code?: string; message?: string }) =>
  error.code === "23505" && (error.message ?? "").includes("goals_idempotency_unique")

async function profileCurrency(supabase: UserClient, userId: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("currency").eq("id", userId).maybeSingle()
  return data?.currency ?? null
}

async function goalOf(supabase: UserClient, goalId: string) {
  const { data } = await supabase.from("goals").select("id, type, currency, target_date, archived_at").eq("id", goalId).maybeSingle()
  return data
}

/**
 * Adds a goal (no `goalId`; once per request key: a repeated submit returns the goal the
 * first one created) or saves an edit (`goalId`; the type stays the goal's own).
 */
export async function saveGoal(supabase: UserClient, input: FormInput): Promise<GoalWriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return { status: "error", message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }

  const existing = input.goalId ? await goalOf(supabase, input.goalId) : null
  if (input.goalId && !existing) return { status: "error", message: NOT_FOUND }
  const currency = existing?.currency ?? (await profileCurrency(supabase, day.userId)) ?? "INR"
  const parsed = goalFormSchema({ currency, today: day.today, currentTargetDate: existing?.target_date ?? null }).safeParse(
    existing ? { ...input, type: existing.type } : input,
  )
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const g = parsed.data

  const fields = {
    name: g.name,
    target_amount_minor: g.targetMinor,
    saved_amount_minor: g.savedMinor,
    target_date: g.targetDate,
    // Validated per type by goalFormSchema; plain JSON values only.
    details: g.details as unknown as Json,
  }

  if (existing) {
    const { data, error } = await supabase.from("goals").update(fields).eq("id", existing.id).select("id")
    if (error) return dbError(error)
    if (!data?.length) return { status: "error", message: NOT_FOUND }
    return { status: "success", message: "Goal saved.", goalId: existing.id }
  }

  const { data, error } = await supabase
    .from("goals")
    // No currency: the database sets it from the profile (clients have no grant on it).
    .insert({ ...fields, type: g.type, idempotency_key: g.idempotencyKey! } as Database["public"]["Tables"]["goals"]["Insert"])
    .select("id")
    .single()
  if (error && isDuplicateKey(error)) {
    // The first submit already added it: answer with that goal instead of an error.
    const { data: first } = await supabase.from("goals").select("id").eq("idempotency_key", g.idempotencyKey!).maybeSingle()
    if (first) return { status: "success", message: "Goal added.", goalId: first.id }
  }
  if (error || !data) return dbError(error ?? {})
  return { status: "success", message: "Goal added.", goalId: data.id }
}

/** Updates only what has been saved so far (in the goal's own currency). */
export async function setGoalSaved(supabase: UserClient, input: FormInput): Promise<GoalWriteResult> {
  const existing = input.goalId ? await goalOf(supabase, input.goalId) : null
  if (!existing) return { status: "error", message: NOT_FOUND }
  const parsed = goalSavedSchema({ currency: existing.currency }).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const { data, error } = await supabase.from("goals").update({ saved_amount_minor: parsed.data.savedMinor }).eq("id", existing.id).select("id")
  if (error) return dbError(error)
  if (!data?.length) return { status: "error", message: NOT_FOUND }
  return { status: "success", message: "Saved amount updated.", goalId: existing.id }
}

/** Archive (kept, hidden from the plan) or restore a goal. The database stamps the time. */
export async function setGoalArchived(supabase: UserClient, input: { goalId: string; archived: boolean }): Promise<GoalWriteResult> {
  const { data, error } = await supabase
    .from("goals")
    .update({ archived_at: input.archived ? new Date().toISOString() : null })
    .eq("id", input.goalId)
    .select("id")
  if (error) return dbError(error)
  if (!data?.length) return { status: "error", message: NOT_FOUND }
  return { status: "success", message: input.archived ? "Goal archived." : "Goal restored.", goalId: input.goalId }
}

/** Sets a category's monthly budget from a month onward (0 or blank ends it). Repeat-safe. */
export async function setCategoryBudget(supabase: UserClient, input: FormInput): Promise<WriteResult> {
  const day = await userToday(supabase)
  if (!day.ok) return { status: "error", message: day.reason === "unauthenticated" ? SIGNED_OUT : TODAY_UNAVAILABLE }
  const currency = (await profileCurrency(supabase, day.userId)) ?? "INR"
  const parsed = budgetFormSchema({ currency, today: day.today }).safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const b = parsed.data
  const { error } = await supabase.rpc("set_category_budget", {
    p_category_id: b.categoryId,
    p_effective_from: b.effectiveFrom,
    p_amount_minor: b.amountMinor,
  })
  if (error) return dbError(error)
  return { status: "success", message: b.amountMinor === 0 ? "Budget removed from that month on." : "Budget saved." }
}
