"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { type WriteResult, removeSpendLimit, saveSpendLimit } from "@fin-creador/api"
import { createClient } from "@/lib/supabase/server"

// Daily spend limit (decisions log 2026-11-24): thin wrappers around the shared writers in
// packages/api (also used by the phone). They run as the signed-in user (RLS, column grants and
// the trigger of migration 20261127120000); the shared code validates every field. Set from the
// Transactions page and from the Safe to spend card, so both pages are refreshed.

async function client() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Ftransactions")
  return supabase
}

function refreshed(result: WriteResult): WriteResult {
  if (result.status === "success") {
    revalidatePath("/transactions")
    revalidatePath("/")
  }
  return result
}

const text = (record: Record<string, unknown>, name: string) => (typeof record[name] === "string" ? (record[name] as string) : "")

export async function saveSpendLimitAction(input: unknown): Promise<WriteResult> {
  const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
  return refreshed(await saveSpendLimit(await client(), { period: text(record, "period"), days: text(record, "days"), amount: text(record, "amount") }))
}

export async function removeSpendLimitAction(): Promise<WriteResult> {
  return refreshed(await removeSpendLimit(await client()))
}
