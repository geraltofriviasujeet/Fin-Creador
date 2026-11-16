import { type IsoDate, addMinor } from "@fin-creador/domain"
import type { UserClient } from "../income/client"

// Entries dated before their account's original opening date (Sprint 9e, owner's rule
// 2026-11-16). Moving an account's opening back (move_account_opening) adds a statement's earlier
// payments, but nothing else from those days: an imported month can hold spending and no
// income. Roma's savings rate, income versus expenses, goal projection and what-if leave these
// entries out, so their results are exactly what they were before any move. Spending totals,
// category breakdowns, search and Reports keep them.
//
// The original opening date of an account is the earliest old_opening_date of its moves; an
// account never moved has none, and none of its entries is left out. An entry belongs to its
// account (account_id): income and refunds arrive in it, expenses leave it. Left out exactly as
// dashboard_breakdown and transaction_summary count them: income; expenses less refunds; per
// currency. Transfers are neither, so they never matter here.

export type BeforeOpeningEntry = {
  type: "income" | "expense" | "refund"
  amountMinor: number
  currency: string
  occurredOn: IsoDate
  categoryId: string | null
}

/** The live income, expense and refund entries from `from` to `to` dated before their account's original opening date. */
export async function loadEntriesBeforeOriginalOpening(
  supabase: UserClient,
  from: IsoDate,
  to: IsoDate,
): Promise<{ ok: true; entries: BeforeOpeningEntry[] } | { ok: false }> {
  const moves = await supabase.from("account_opening_moves").select("account_id, old_opening_date")
  if (moves.error) return { ok: false }
  const original = new Map<string, IsoDate>()
  for (const m of moves.data) {
    const known = original.get(m.account_id)
    if (!known || m.old_opening_date < known) original.set(m.account_id, m.old_opening_date)
  }
  const entries: BeforeOpeningEntry[] = []
  for (const [accountId, opening] of original) {
    if (opening <= from) continue
    const { data, error } = await supabase
      .from("transactions")
      .select("type, amount_minor, currency, occurred_on, category_id")
      .eq("account_id", accountId)
      .in("type", ["income", "expense", "refund"])
      .is("voided_at", null)
      .gte("occurred_on", from)
      .lte("occurred_on", to)
      .lt("occurred_on", opening)
    if (error) return { ok: false }
    for (const e of data) {
      if (e.type !== "income" && e.type !== "expense" && e.type !== "refund") continue
      entries.push({ type: e.type, amountMinor: e.amount_minor, currency: e.currency, occurredOn: e.occurred_on, categoryId: e.category_id })
    }
  }
  return { ok: true, entries }
}

/** What the entries add to income and to spending (expenses less refunds), in one currency. */
export function beforeOpeningTotals(entries: readonly BeforeOpeningEntry[], currency: string) {
  const out = { incomeMinor: 0, expenseMinor: 0, incomeCount: 0, expenseCount: 0, refundCount: 0, refundMinor: 0 }
  for (const e of entries) {
    if (e.currency !== currency) continue
    if (e.type === "income") {
      out.incomeMinor = addMinor(out.incomeMinor, e.amountMinor)
      out.incomeCount++
    } else if (e.type === "expense") {
      out.expenseMinor = addMinor(out.expenseMinor, e.amountMinor)
      out.expenseCount++
    } else {
      out.expenseMinor = addMinor(out.expenseMinor, -e.amountMinor)
      out.refundMinor = addMinor(out.refundMinor, e.amountMinor)
      out.refundCount++
    }
  }
  return out
}

type MonthRow = { month: IsoDate; incomeMinor: number; expenseMinor: number; categories: { categoryId: string | null; expenseMinor: number }[] }

/** Monthly cash-flow rows (as loadCashFlow builds them) without the entries; a category left at nothing is dropped. */
export function monthlyWithout<T extends MonthRow>(monthly: readonly T[], entries: readonly BeforeOpeningEntry[], currency: string): T[] {
  return monthly.map((row) => {
    const inMonth = entries.filter((e) => e.occurredOn.slice(0, 7) === row.month.slice(0, 7))
    if (inMonth.length === 0) return row
    const t = beforeOpeningTotals(inMonth, currency)
    const categories = row.categories
      .map((c) => ({
        ...c,
        expenseMinor: inMonth
          .filter((e) => e.currency === currency && e.type !== "income" && e.categoryId === c.categoryId)
          .reduce((s, e) => addMinor(s, e.type === "refund" ? e.amountMinor : -e.amountMinor), c.expenseMinor),
      }))
      .filter((c) => c.expenseMinor !== 0 || row.categories.find((o) => o.categoryId === c.categoryId)!.expenseMinor === 0)
    return { ...row, incomeMinor: addMinor(row.incomeMinor, -t.incomeMinor), expenseMinor: addMinor(row.expenseMinor, -t.expenseMinor), categories }
  })
}
