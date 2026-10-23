"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  type FormInput,
  type LedgerItem,
  type PageCursor,
  type TransactionPage,
  type WriteResult,
  loadEntryHistory,
  loadTransactionPage,
  saveTransaction,
  voidTransaction,
} from "@fin-creador/api"
import { ENTRY_TYPES } from "@fin-creador/schemas"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

// Thin wrappers around the shared loaders and writers in packages/api (also used by the
// mobile app). They run as the signed-in user (RLS); the shared code validates every
// input, so these only add the sign-in redirect and refresh the affected pages.

async function client() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Ftransactions")
  return supabase
}

const ENTRY_FIELDS = [
  "transactionId", "type", "amount", "categoryId", "accountId", "counterAccountId",
  "paymentMode", "occurredOn", "note", "idempotencyKey",
] as const

/** Only the known fields, as strings (server actions take any value a client sends). */
function fields(input: unknown, names: readonly string[]): FormInput {
  const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
  return Object.fromEntries(names.map((n) => [n, typeof record[n] === "string" ? (record[n] as string) : ""]))
}

function refreshed(result: WriteResult): WriteResult {
  if (result.status === "success") {
    revalidatePath("/transactions")
    revalidatePath("/income")
  }
  return result
}

export async function saveTransactionAction(input: unknown): Promise<WriteResult> {
  return refreshed(await saveTransaction(await client(), fields(input, ENTRY_FIELDS)))
}

export async function voidTransactionAction(input: unknown): Promise<WriteResult> {
  return refreshed(await voidTransaction(await client(), fields(input, ["transactionId", "reason", "idempotencyKey"])))
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const pageRequest = z.object({
  filters: z.object({
    from: isoDate,
    to: isoDate,
    type: z.enum(ENTRY_TYPES).nullable().optional(),
    categoryId: z.uuid().nullable().optional(),
    accountId: z.uuid().nullable().optional(),
    query: z.string().max(100).nullable().optional(),
    includeVoided: z.boolean().optional(),
  }),
  currency: z.string().regex(/^[A-Z]{3}$/),
  cursor: z.string().max(200),
})

/** The next page of the list, after the opaque cursor the previous page returned. */
export async function loadMoreTransactionsAction(input: unknown): Promise<TransactionPage> {
  const request = pageRequest.safeParse(input)
  if (!request.success) return { ok: false, reason: "invalid_cursor" }
  const { filters, currency, cursor } = request.data
  return loadTransactionPage(await client(), filters, { currency, cursor: cursor as PageCursor })
}

export async function loadHistoryAction(id: unknown): Promise<{ ok: true; versions: LedgerItem[] } | { ok: false }> {
  if (!z.uuid().safeParse(id).success) return { ok: false }
  return loadEntryHistory(await client(), id as string)
}
