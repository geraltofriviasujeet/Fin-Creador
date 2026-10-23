import { addMinor, parseAmount } from "@fin-creador/domain"
import type { PaymentModeValue } from "@fin-creador/schemas"
import type { UserClient } from "../income/client"
import type { Database } from "../database.types"
import type { EntryType, LedgerItem, TransactionTotals } from "./types"

export type LedgerRow = Database["public"]["Functions"]["list_transactions"]["Returns"][number]

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

export function toLedgerItem(row: LedgerRow): LedgerItem {
  return {
    id: row.id,
    type: row.type as EntryType,
    amountMinor: row.amount_minor,
    currency: row.currency,
    occurredOn: row.occurred_on,
    accountId: row.account_id,
    counterAccountId: row.counter_account_id,
    categoryId: row.category_id,
    voided: row.voided_at !== null,
    replacesId: row.replaces_id,
    note: row.note,
    paymentMode: row.payment_mode as PaymentModeValue | null,
    createdAt: row.created_at,
    voidReason: row.void_reason,
  }
}

const searchArgs = (f: TransactionFilters, currency: string) => {
  const query = f.query?.trim() || undefined
  return {
    p_from: f.from,
    p_to: f.to,
    p_category_id: f.categoryId || undefined,
    p_account_id: f.accountId || undefined,
    p_query: query,
    p_amount_minor: queryAmountMinor(query, currency) ?? undefined,
  }
}

export type TransactionPage =
  | { ok: true; items: LedgerItem[]; nextCursor: PageCursor | null }
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

  const { data, error } = await supabase.rpc("list_transactions", {
    ...searchArgs(filters, currency),
    p_type: filters.type ?? undefined,
    p_include_voided: filters.includeVoided ?? false,
    p_after_occurred_on: after?.occurredOn,
    p_after_created_at: after?.createdAt,
    p_after_id: after?.id,
    p_limit: limit,
  })
  if (error || !Array.isArray(data)) return { ok: false, reason: "unavailable" }

  const last = data.at(-1)
  return { ok: true, items: data.map(toLedgerItem), nextCursor: data.length === limit && last ? encodeCursor(last) : null }
}

/**
 * Totals for the filters (the type tab and "show voided" don't apply): income and expenses
 * in `currency`; entries in other currencies are counted, never converted. Transfers are
 * counted, never added to income or expenses.
 */
export async function loadTransactionTotals(
  supabase: UserClient,
  filters: TransactionFilters,
  currency: string,
): Promise<{ ok: true; totals: TransactionTotals } | { ok: false }> {
  const { data, error } = await supabase.rpc("transaction_summary", searchArgs(filters, currency))
  if (error || !Array.isArray(data)) return { ok: false }
  const same = data.find((r) => r.currency === currency)
  const incomeMinor = same?.income_minor ?? 0
  const expenseMinor = same?.expense_minor ?? 0
  return {
    ok: true,
    totals: {
      incomeMinor,
      expenseMinor,
      netMinor: addMinor(incomeMinor, -expenseMinor),
      incomeCount: same?.income_count ?? 0,
      expenseCount: same?.expense_count ?? 0,
      transferCount: same?.transfer_count ?? 0,
      otherCurrencyCount: data
        .filter((r) => r.currency !== currency)
        .reduce((n, r) => n + r.income_count + r.expense_count + r.transfer_count, 0),
    },
  }
}

/** Every version of an entry, oldest first, following replaces_id back from `id`. */
export async function loadEntryHistory(
  supabase: UserClient,
  id: string,
): Promise<{ ok: true; versions: LedgerItem[] } | { ok: false }> {
  const versions: LedgerItem[] = []
  let next: string | null = id
  // An entry edited more than 100 times is cut off at 100 versions.
  while (next && versions.length < 100) {
    const { data, error }: { data: LedgerRow | null; error: unknown } = await supabase
      .from("transactions")
      .select("*")
      .eq("id", next)
      .maybeSingle()
    if (error || !data) return { ok: false }
    versions.unshift(toLedgerItem(data))
    next = data.replaces_id
  }
  return { ok: true, versions }
}

/** One version by id, or null if it isn't the caller's (RLS) or doesn't exist. */
export async function loadEntry(supabase: UserClient, id: string): Promise<LedgerItem | null> {
  const { data, error } = await supabase.from("transactions").select("*").eq("id", id).maybeSingle()
  return error || !data ? null : toLedgerItem(data)
}
