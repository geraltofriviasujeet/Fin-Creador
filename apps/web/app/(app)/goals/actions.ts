"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { type FormInput, type WriteResult, deleteGoal, saveGoal, setCategoryBudget, setGoalArchived, setGoalSaved } from "@fin-creador/api"
import { TRIP_COST_LINES } from "@fin-creador/domain"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

// Thin wrappers around the shared goal and budget writers in packages/api. They run as the
// signed-in user (RLS); the shared code validates every input and recomputes the target.

async function client() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Fgoals")
  return supabase
}

/** Only the known fields, as strings (server actions take any value a client sends). */
function fields(input: unknown, names: readonly string[]): FormInput {
  const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
  return Object.fromEntries(names.map((n) => [n, typeof record[n] === "string" ? (record[n] as string) : ""]))
}

function refreshed<R extends { status: "success" | "error" }>(result: R): R {
  if (result.status === "success") {
    revalidatePath("/goals")
    revalidatePath("/")
  }
  return result
}

const GOAL_FIELDS = [
  "goalId", "type", "name", "targetDate", "saved", "idempotencyKey", "amount", "description",
  "scope", "place", "people", "days", "travelMode", "stay", ...TRIP_COST_LINES.map((l) => `cost_${l}`),
  "condition", "model", "purpose", "city", "item", "payment", "price", "extras", "downPayment", "rate", "months",
] as const

export async function saveGoalAction(input: unknown): Promise<WriteResult> {
  return refreshed(await saveGoal(await client(), fields(input, GOAL_FIELDS)))
}

export async function setGoalSavedAction(input: unknown): Promise<WriteResult> {
  return refreshed(await setGoalSaved(await client(), fields(input, ["goalId", "saved"])))
}

const goalRef = z.object({ goalId: z.uuid(), archived: z.boolean() })

export async function setGoalArchivedAction(input: unknown): Promise<WriteResult> {
  const r = goalRef.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that goal." }
  return refreshed(await setGoalArchived(await client(), r.data))
}

const goalId = z.object({ goalId: z.uuid() })

/** Permanent delete of an archived goal (the database refuses any other). */
export async function deleteGoalAction(input: unknown): Promise<WriteResult> {
  const r = goalId.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that goal." }
  return refreshed(await deleteGoal(await client(), r.data))
}

export async function setCategoryBudgetAction(input: unknown): Promise<WriteResult> {
  return refreshed(await setCategoryBudget(await client(), fields(input, ["categoryId", "month", "amount"])))
}
