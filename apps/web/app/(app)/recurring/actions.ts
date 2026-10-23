"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  type FormInput,
  type WriteResult,
  confirmRecurringOccurrence,
  saveRecurringRule,
  setRecurringRuleArchived,
  skipRecurringOccurrence,
  undoRecurringSkip,
} from "@fin-creador/api"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

// Thin wrappers around the shared recurring writers in packages/api (also used by the
// mobile app). They run as the signed-in user (RLS); the shared code validates every
// input, so these only add the sign-in redirect and refresh the affected pages.

async function client() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Frecurring")
  return supabase
}

/** Only the known fields, as strings (server actions take any value a client sends). */
function fields(input: unknown, names: readonly string[]): FormInput {
  const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
  return Object.fromEntries(names.map((n) => [n, typeof record[n] === "string" ? (record[n] as string) : ""]))
}

function refreshed(result: WriteResult): WriteResult {
  if (result.status === "success") {
    revalidatePath("/recurring")
    revalidatePath("/transactions")
    revalidatePath("/income")
  }
  return result
}

const RULE_FIELDS = [
  "ruleId", "type", "amount", "categoryId", "accountId", "counterAccountId", "paymentMode",
  "frequency", "startDate", "endDate", "note", "idempotencyKey",
] as const

export async function saveRecurringRuleAction(input: unknown): Promise<WriteResult> {
  return refreshed(await saveRecurringRule(await client(), fields(input, RULE_FIELDS)))
}

const ruleRef = z.object({ ruleId: z.uuid(), archived: z.boolean() })

export async function setRecurringRuleArchivedAction(input: unknown): Promise<WriteResult> {
  const r = ruleRef.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that recurring item." }
  return refreshed(await setRecurringRuleArchived(await client(), r.data))
}

const CONFIRM_FIELDS = [
  "ruleId", "occurrenceDate", "type", "amount", "occurredOn", "accountId", "counterAccountId",
  "paymentMode", "note", "idempotencyKey",
] as const

export async function confirmOccurrenceAction(input: unknown): Promise<WriteResult> {
  return refreshed(await confirmRecurringOccurrence(await client(), fields(input, CONFIRM_FIELDS)))
}

export async function skipOccurrenceAction(input: unknown): Promise<WriteResult> {
  return refreshed(await skipRecurringOccurrence(await client(), fields(input, ["ruleId", "occurrenceDate", "reason", "idempotencyKey"])))
}

const occurrenceRef = z.object({ ruleId: z.uuid(), occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

export async function undoSkipAction(input: unknown): Promise<WriteResult> {
  const r = occurrenceRef.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that skip." }
  return refreshed(await undoRecurringSkip(await client(), r.data))
}
