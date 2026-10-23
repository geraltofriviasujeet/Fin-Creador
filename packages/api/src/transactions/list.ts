import { parseAmount } from "@fin-creador/domain"
import type { UserClient } from "../income/client"
import type { Database } from "../database.types"

export type LedgerRow = Database["public"]["Functions"]["list_transactions"]["Returns"][number]
export type EntryType = "income" | "expense" | "transfer"

export type TransactionFilters = {
  from: string
  to: string
  type?: EntryType | null
  categoryId?: string | null
  accountId?: string | null
  query?: string | null
  includeVoided?: boolean
}

declare const cursorBrand: unique symbol
/**
 * Where the next page starts. Opaque: pass back exactly what a page returned. It holds the
 * last row's created_at as the raw string the database sent (microseconds); a JS Date would
 * cut it to milliseconds and the next page would repeat or skip rows.
 */
export type PageCursor = string & { readonly [cursorBrand]: true }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function encodeCursor(row: Pick<LedgerRow, "occurred_on" | "created_at" | "id">): PageCursor {
  return JSON.stringify([row.occurred_on, row.created_at, row.id]) as PageCursor
}

function decodeCursor(cursor: string): { occurredOn: string; createdAt: string; id: string } | null {
  let parts: unknown
  try {
    parts = JSON.parse(cursor)
  } catch {
    return null
  }
  if (!Array.isArray(parts) || parts.length !== 3 || !parts.every((p) => typeof p === "string")) return null
  const [occurredOn, createdAt, id] = parts as [string, string, string]
  if (!DATE.test(occurredOn) || !TIMESTAMP.test(createdAt) || !UUID.test(id)) return null
  return { occurredOn, createdAt, id }
}

/** The search text read as an amount in the user's currency, or null (then only text matches). */
export function queryAmountMinor(query: string | null | undefined, currency: string): number | null {
  if (!query) return null
  const parsed = parseAmount(query.trim(), currency)
  return parsed.ok ? parsed.minor : null
}

export type TransactionPage =
  | { ok: true; rows: LedgerRow[]; nextCursor: PageCursor | null }
  | { ok: false; reason: "unavailable" | "invalid_cursor" }

/**
 * One page of the signed-in user's entries, newest first (list_transactions; RLS applies).
 * Pass the previous page's nextCursor to continue; null means there are no more rows.
 */
export async function loadTransactionPage(
  supabase: UserClient,
  filters: TransactionFilters,
  { currency, cursor = null, limit = 50 }: { currency: string; cursor?: PageCursor | null; limit?: number },
): Promise<TransactionPage> {
  const after = cursor === null ? null : decodeCursor(cursor)
  if (cursor !== null && !after) return { ok: false, reason: "invalid_cursor" }

  const query = filters.query?.trim() || undefined
  const amount = queryAmountMinor(query, currency)
  const { data, error } = await supabase.rpc("list_transactions", {
    p_from: filters.from,
    p_to: filters.to,
    p_type: filters.type ?? undefined,
    p_category_id: filters.categoryId ?? undefined,
    p_account_id: filters.accountId ?? undefined,
    p_query: query,
    p_amount_minor: amount ?? undefined,
    p_include_voided: filters.includeVoided ?? false,
    p_after_occurred_on: after?.occurredOn,
    p_after_created_at: after?.createdAt,
    p_after_id: after?.id,
    p_limit: limit,
  })
  if (error || !Array.isArray(data)) return { ok: false, reason: "unavailable" }

  const last = data.at(-1)
  return { ok: true, rows: data, nextCursor: data.length === limit && last ? encodeCursor(last) : null }
}
