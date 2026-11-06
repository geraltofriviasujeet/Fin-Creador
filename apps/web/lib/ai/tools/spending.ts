import { loadTransactionTotals } from "@fin-creador/api"
import { formatMoney } from "@fin-creador/domain"
import { type PeriodInput, periodInput, periodRangeOrThrow } from "./period"
import { type FinanceTool, ToolError } from "./types"

// spending_for_period (Sprint 10.1): what the person spent in a period. The same figure as
// the Overview's "Spent" card (transaction_summary): expenses net of refunds, transfers left
// out, entries in other currencies counted but never converted. Periods: see ./period.

export { MAX_RANGE_DAYS, resolvePeriod } from "./period"

export type SpendingInput = PeriodInput

export const spendingTool: FinanceTool<SpendingInput> = {
  name: "spending_for_period",
  description:
    "What the person spent in a period: expenses minus refunds, in their own currency, with the number of expenses. Transfers between their own accounts are not spending.",
  input: periodInput,
  async run(ctx, p) {
    const range = periodRangeOrThrow(p, ctx.today)

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
