import { type IsoDate, addDays, addMinor, formatMoney } from "@fin-creador/domain"
import type { UserClient } from "../income/client"
import { fullDate } from "../transactions/format"

// Linking an imported refund to the purchase it reverses (Sprint 9c), shared by the card and bank
// reviews on web and mobile. A link is optional: an unlinked refund still counts (an inflow in an
// expense category). The database decides what a link may point at (refund_check_link: a live
// expense of the same person and currency, not a payment entry or a statement difference, dated on
// or before the refund, linked refunds at most its amount); this only offers and suggests.

/** How far before a statement's first line a refunded purchase is looked for. */
export const REFUND_LOOKBACK_DAYS = 180
const MAX_PURCHASES = 2000
const MAX_LINKED = 5000

/** A purchase an imported refund may be linked to, with what is still left to refund on it. */
export type RefundCandidate = {
  id: string
  date: IsoDate
  amountMinor: number
  leftMinor: number
  categoryId: string | null
  note: string | null
}

/**
 * Live expenses on the account from REFUND_LOOKBACK_DAYS before `from` up to `to`, newest first,
 * less the live refunds already linked to them; null when a read fails. Read as the signed-in
 * user (RLS): only their own entries.
 */
export async function loadRefundCandidates(supabase: UserClient, accountId: string, from: IsoDate, to: IsoDate): Promise<RefundCandidate[] | null> {
  const start = addDays(from, -REFUND_LOOKBACK_DAYS)
  const [purchases, linked, differences] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, occurred_on, amount_minor, category_id, note")
      .eq("account_id", accountId)
      .eq("type", "expense")
      .is("voided_at", null)
      .is("due_payment_id", null)
      .is("liability_payment_id", null)
      .gte("occurred_on", start)
      .lte("occurred_on", to)
      .order("occurred_on", { ascending: false })
      .limit(MAX_PURCHASES),
    supabase
      .from("transactions")
      .select("refund_of_id, amount_minor")
      .eq("type", "refund")
      .is("voided_at", null)
      .not("refund_of_id", "is", null)
      .gte("occurred_on", start)
      .limit(MAX_LINKED),
    supabase.from("card_statements").select("difference_transaction_id").not("difference_transaction_id", "is", null),
  ])
  if (purchases.error || linked.error || differences.error) return null
  const refunded = new Map<string, number>()
  for (const r of linked.data) if (r.refund_of_id) refunded.set(r.refund_of_id, addMinor(refunded.get(r.refund_of_id) ?? 0, r.amount_minor))
  const difference = new Set(differences.data.map((d) => d.difference_transaction_id))
  return purchases.data
    .filter((p) => !difference.has(p.id))
    .map((p) => ({
      id: p.id,
      date: p.occurred_on,
      amountMinor: p.amount_minor,
      leftMinor: Math.max(addMinor(p.amount_minor, -(refunded.get(p.id) ?? 0)), 0),
      categoryId: p.category_id,
      note: p.note,
    }))
}

/**
 * A suggested purchase per refund line (same order as `lines`; null for none): the newest purchase
 * dated on or before the refund with exactly the refund's amount still left to refund. Each
 * purchase is suggested once; partial refunds are never guessed (the person picks them).
 */
export function suggestRefundLinks(lines: readonly { date: IsoDate; amountMinor: number }[], candidates: readonly RefundCandidate[]): (string | null)[] {
  const left = new Map(candidates.map((c) => [c.id, c.leftMinor]))
  const order = lines.map((l, i) => ({ ...l, i })).sort((a, b) => a.date.localeCompare(b.date) || a.i - b.i)
  const out: (string | null)[] = lines.map(() => null)
  for (const line of order) {
    const match = candidates.find((c) => c.date <= line.date && left.get(c.id) === line.amountMinor && c.amountMinor === line.amountMinor)
    if (!match) continue
    out[line.i] = match.id
    left.set(match.id, 0)
  }
  return out
}

const MAX_OPTIONS = 30

/** The purchases a refund line may be linked to: on or before its date, enough left to refund (and the chosen one). */
export function refundOptions(line: { date: string; amountMinor: number | null }, candidates: readonly RefundCandidate[], chosen: string): RefundCandidate[] {
  const fits = (c: RefundCandidate) => c.id === chosen || (c.date <= line.date && (line.amountMinor === null || c.leftMinor >= line.amountMinor))
  return candidates.filter(fits).slice(0, MAX_OPTIONS)
}

/** "12 Oct 2026 · Amazon · ₹1,200" (and what is left, when part is refunded already). */
export function refundCandidateLabel(c: RefundCandidate, categoryName: (id: string | null) => string | null, currency: string): string {
  const money = (minor: number) => formatMoney(minor, { currency })
  const what = c.note ?? categoryName(c.categoryId) ?? "Purchase"
  return `${fullDate(c.date)} · ${what} · ${money(c.amountMinor)}${c.leftMinor < c.amountMinor ? ` (${money(c.leftMinor)} left)` : ""}`
}
