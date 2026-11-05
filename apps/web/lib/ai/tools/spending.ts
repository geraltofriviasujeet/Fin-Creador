import { z } from "zod"
import { loadTransactionTotals } from "@fin-creador/api"
import {
  type DateRange,
  type IsoDate,
  addDays,
  formatMoney,
  isIsoDate,
  monthRange,
  previousMonthRange,
  yearRange,
} from "@fin-creador/domain"
import { type FinanceTool, ToolError } from "./types"

// spending_for_period (Sprint 10.1): what the person spent in a period. The same figure as
// the Overview's "Spent" card (transaction_summary): expenses net of refunds, transfers left
// out, entries in other currencies counted but never converted. Periods are inclusive and
// resolved against the person's own today (their profile time zone).

export const SPENDING_PERIODS = ["this_month", "last_month", "this_year", "last_year", "last_7_days", "last_30_days", "custom"] as const

/** The longest custom range (about five years). */
export const MAX_RANGE_DAYS = 5 * 366

const input = z
  .object({
    period: z.enum(SPENDING_PERIODS).describe("The period. Use a named one when it fits; 'custom' needs from and to."),
    from: z.string().optional().describe("First day, YYYY-MM-DD (custom only)."),
    to: z.string().optional().describe("Last day, YYYY-MM-DD (custom only)."),
  })
  .strict()

export type SpendingInput = z.infer<typeof input>

/** The inclusive range for a period, or why it can't be used. Future days are cut at today. */
export function resolvePeriod(p: SpendingInput, today: IsoDate): { ok: true; range: DateRange } | { ok: false; message: string } {
  switch (p.period) {
    case "this_month":
      return { ok: true, range: { start: monthRange(today).start, end: today } }
    case "last_month":
      return { ok: true, range: previousMonthRange(today) }
    case "this_year":
      return { ok: true, range: { start: yearRange(today).start, end: today } }
    case "last_year":
      return { ok: true, range: yearRange(`${Number(today.slice(0, 4)) - 1}-01-01`) }
    case "last_7_days":
      return { ok: true, range: { start: addDays(today, -6), end: today } }
    case "last_30_days":
      return { ok: true, range: { start: addDays(today, -29), end: today } }
    case "custom": {
      const { from = "", to = "" } = p
      if (!isIsoDate(from) || !isIsoDate(to)) return { ok: false, message: "A custom period needs from and to as YYYY-MM-DD." }
      if (from > to) return { ok: false, message: "from must be on or before to." }
      if (from > today) return { ok: false, message: "That period is in the future." }
      const end = to > today ? today : to
      if (from < addDays(end, -(MAX_RANGE_DAYS - 1))) return { ok: false, message: "A period can be at most five years." }
      return { ok: true, range: { start: from, end } }
    }
  }
}

export const spendingTool: FinanceTool<SpendingInput> = {
  name: "spending_for_period",
  description:
    "What the person spent in a period: expenses minus refunds, in their own currency, with the number of expenses. Transfers between their own accounts are not spending.",
  input,
  async run(ctx, p) {
    const resolved = resolvePeriod(p, ctx.today)
    if (!resolved.ok) throw new ToolError(resolved.message)
    const { range } = resolved

    const result = await loadTransactionTotals(ctx.supabase, { from: range.start, to: range.end }, ctx.currency)
    if (!result.ok) throw new ToolError("The spending figures couldn't be loaded.")
    const t = result.totals
    const money = (minor: number) => formatMoney(minor, { currency: ctx.currency })

    return {
      data: {
        period: { from: range.start, to: range.end },
        currency: ctx.currency,
        spent: money(t.expenseMinor),
        refunds: money(t.refundMinor),
        expense_count: t.expenseCount,
        refund_count: t.refundCount,
        other_currency_entries: t.otherCurrencyCount,
        note: "spent is expenses minus refunds. Entries in other currencies are counted, not included or converted.",
      },
      figures: [
        { label: "Spent", kind: "money", minor: t.expenseMinor, currency: ctx.currency },
        { label: "Refunds", hideWhenZero: true, kind: "money", minor: t.refundMinor, currency: ctx.currency },
        { label: "Expenses", kind: "count", value: t.expenseCount },
        { label: "Refunds received", hideWhenZero: true, kind: "count", value: t.refundCount },
        { label: "Entries in other currencies", hideWhenZero: true, kind: "count", value: t.otherCurrencyCount },
      ],
      period: range,
    }
  },
}
