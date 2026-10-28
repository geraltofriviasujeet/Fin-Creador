import { type CsvCell, type IsoDate, currencyMinorDigits, csvText, isIsoDate, minorUnitsToDecimalString, toCsv } from "@fin-creador/domain"
import { z } from "zod"
import { type UserClient, userToday } from "../income/client"
import { paymentModeLabel } from "../transactions/format"
import type { PaymentModeValue } from "@fin-creador/schemas"

// CSV export of the signed-in user's transactions (Sprint 8c). Read with their own session, so
// row level security decides what is visible (never the service role). Current versions only:
// an edit's old version is never exported; voided entries only when asked for. Text the person
// typed or named is guarded against formula injection (packages/domain/src/csv.ts); dates are
// ISO, amounts plain decimals with the currency in its own column. Nothing is stored or logged.

/** Rows per read (PostgREST returns at most 1,000). */
const PAGE = 1000
/** Most rows in one file: about 10 reads, so an export finishes in a few seconds. */
export const EXPORT_ROW_CAP = 10_000
/** Longest range in one file. */
export const EXPORT_MAX_DAYS = 3660

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const optionalId = z
  .string()
  .trim()
  .transform((v) => v || null)
  .refine((v) => v === null || UUID.test(v), "invalid")
  .nullable()
  .optional()
  .transform((v) => v ?? null)

export const exportParamsSchema = z
  .object({
    from: z.string().refine(isIsoDate, "invalid"),
    to: z.string().refine(isIsoDate, "invalid"),
    account: optionalId,
    category: optionalId,
    voided: z
      .enum(["0", "1"])
      .optional()
      .transform((v) => v === "1"),
  })
  .refine((p) => p.from <= p.to, { message: "order", path: ["to"] })
  .refine((p) => (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 < EXPORT_MAX_DAYS, { message: "span", path: ["to"] })

export type ExportParams = z.output<typeof exportParamsSchema>

export const EXPORT_MESSAGES = {
  invalid: "Choose a valid date range (at most 10 years).",
  signedOut: "Sign in to export your transactions.",
  tooMany: `More than ${EXPORT_ROW_CAP.toLocaleString("en-IN")} entries in this range. Choose a shorter range, an account or a category.`,
  unavailable: "We couldn't export your transactions. Check your connection and try again.",
} as const

export type ExportResult =
  | { ok: true; csv: string; filename: string; rowCount: number }
  | { ok: false; status: 400 | 401 | 413 | 503; message: string }

export const EXPORT_HEADER = ["Date", "Type", "Amount", "Currency", "Account", "To account", "Category", "Payment mode", "Note", "Voided"] as const

const TYPE_WORD: Record<string, string> = { income: "Income", expense: "Expense", transfer: "Transfer" }

/** No personal details: only the dates. */
export const exportFilename = (from: IsoDate, to: IsoDate) => `fincreador-transactions-${from}-to-${to}.csv`

type Row = {
  id: string
  type: string
  amount_minor: number
  currency: string
  occurred_on: string
  account_id: string
  counter_account_id: string | null
  category_id: string | null
  note: string | null
  payment_mode: string | null
  voided_at: string | null
}

export async function exportTransactionsCsv(supabase: UserClient, raw: Record<string, string | undefined>): Promise<ExportResult> {
  const parsed = exportParamsSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, status: 400, message: EXPORT_MESSAGES.invalid }
  const p = parsed.data
  const day = await userToday(supabase)
  if (!day.ok) return day.reason === "unauthenticated" ? { ok: false, status: 401, message: EXPORT_MESSAGES.signedOut } : { ok: false, status: 503, message: EXPORT_MESSAGES.unavailable }

  const [accounts, categories] = await Promise.all([supabase.from("accounts").select("id, name"), supabase.from("categories").select("id, name")])
  if (accounts.error || categories.error) return { ok: false, status: 503, message: EXPORT_MESSAGES.unavailable }

  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("transactions")
      .select("id, type, amount_minor, currency, occurred_on, account_id, counter_account_id, category_id, note, payment_mode, voided_at")
      .gte("occurred_on", p.from)
      .lte("occurred_on", p.to)
    if (!p.voided) q = q.is("voided_at", null)
    if (p.account) q = q.or(`account_id.eq.${p.account},counter_account_id.eq.${p.account}`)
    if (p.category) q = q.eq("category_id", p.category)
    const { data, error } = await q.order("occurred_on").order("created_at").order("id").range(from, from + PAGE - 1)
    if (error || !data) return { ok: false, status: 503, message: EXPORT_MESSAGES.unavailable }
    rows.push(...data)
    if (rows.length > EXPORT_ROW_CAP) return { ok: false, status: 413, message: EXPORT_MESSAGES.tooMany }
    if (data.length < PAGE) break
  }

  // With voided entries: an edit's old version (voided, replaced by a newer one) still never shows.
  const voidedIds = rows.filter((r) => r.voided_at !== null).map((r) => r.id)
  const replaced = new Set<string>()
  for (let i = 0; i < voidedIds.length; i += 200) {
    const { data, error } = await supabase.from("transactions").select("replaces_id").in("replaces_id", voidedIds.slice(i, i + 200))
    if (error || !data) return { ok: false, status: 503, message: EXPORT_MESSAGES.unavailable }
    for (const r of data) if (r.replaces_id) replaced.add(r.replaces_id)
  }

  const accountName = new Map(accounts.data.map((a) => [a.id, a.name]))
  const categoryName = new Map(categories.data.map((c) => [c.id, c.name]))
  const lines: CsvCell[][] = rows
    .filter((r) => !replaced.has(r.id))
    .map((r) => [
      r.occurred_on,
      TYPE_WORD[r.type] ?? r.type,
      minorUnitsToDecimalString(r.amount_minor, currencyMinorDigits(r.currency)),
      r.currency,
      csvText(accountName.get(r.account_id)),
      csvText(r.counter_account_id ? accountName.get(r.counter_account_id) : ""),
      csvText(r.category_id ? categoryName.get(r.category_id) : ""),
      csvText(paymentModeLabel(r.payment_mode as PaymentModeValue | null)),
      csvText(r.note),
      r.voided_at ? "Yes" : "",
    ])
  return { ok: true, csv: toCsv(EXPORT_HEADER, lines), filename: exportFilename(p.from, p.to), rowCount: lines.length }
}
