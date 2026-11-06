import { loadTransactionTotals } from "@fin-creador/api"
import { formatMoney, formatPercentFromBasisPoints, savingsRateBasisPoints } from "@fin-creador/domain"
import { type PeriodInput, periodData, periodInput, periodRangeOrThrow } from "./period"
import { type FinanceTool, type ToolContext, ToolError } from "./types"

// income_vs_expenses and savings_rate (Sprint 10.2): the Overview's income, spent, net and
// savings-rate figures (transaction_summary; savingsRateBasisPoints in packages/domain).
// Transfers are neither income nor spending; other currencies are counted, never converted.

async function totalsFor(ctx: ToolContext, p: PeriodInput) {
  const range = periodRangeOrThrow(p, ctx.today)
  const result = await loadTransactionTotals(ctx.supabase, { from: range.start, to: range.end }, ctx.currency)
  if (!result.ok) throw new ToolError("The income and spending figures couldn't be loaded.")
  return { range, totals: result.totals }
}

const NOTE = "spent is expenses minus refunds; net is income minus spent. Transfers between own accounts are left out. Entries in other currencies are counted, not included or converted."

export const incomeVsExpensesTool: FinanceTool<PeriodInput> = {
  name: "income_vs_expenses",
  description: "Income, spending (expenses minus refunds) and the difference (net) for a period, in the person's own currency, with entry counts.",
  input: periodInput,
  async run(ctx, p) {
    const { range, totals: t } = await totalsFor(ctx, p)
    const money = (minor: number) => formatMoney(minor, { currency: ctx.currency })
    return {
      data: {
        period: periodData(range),
        currency: ctx.currency,
        income: money(t.incomeMinor),
        spent: money(t.expenseMinor),
        net: money(t.netMinor),
        income_count: t.incomeCount,
        expense_count: t.expenseCount,
        other_currency_entries: t.otherCurrencyCount,
        note: NOTE,
      },
      figures: [
        { label: "Income", kind: "money", minor: t.incomeMinor, currency: ctx.currency },
        { label: "Spent", kind: "money", minor: t.expenseMinor, currency: ctx.currency },
        { label: "Net", kind: "money", minor: t.netMinor, currency: ctx.currency },
        { label: "Income entries", kind: "count", value: t.incomeCount },
        { label: "Expenses", kind: "count", value: t.expenseCount },
        { label: "Entries in other currencies", hideWhenZero: true, kind: "count", value: t.otherCurrencyCount },
      ],
      period: range,
    }
  },
}

export const savingsRateTool: FinanceTool<PeriodInput> = {
  name: "savings_rate",
  description:
    "The savings rate for a period: net (income minus spending) as a share of income, as the Overview shows it. No rate when there was no income.",
  input: periodInput,
  async run(ctx, p) {
    const { range, totals: t } = await totalsFor(ctx, p)
    const bps = savingsRateBasisPoints(t)
    const money = (minor: number) => formatMoney(minor, { currency: ctx.currency })
    return {
      data: {
        period: periodData(range),
        currency: ctx.currency,
        savings_rate: bps === null ? null : formatPercentFromBasisPoints(bps),
        income: money(t.incomeMinor),
        spent: money(t.expenseMinor),
        net: money(t.netMinor),
        note:
          bps === null
            ? "There is no savings rate: no income was recorded in this period."
            : "savings_rate is net divided by income. Below zero means more was spent than earned.",
      },
      figures: [
        ...(bps === null ? [] : [{ label: "Savings rate", kind: "percent" as const, bps }]),
        { label: "Income", kind: "money", minor: t.incomeMinor, currency: ctx.currency },
        { label: "Spent", kind: "money", minor: t.expenseMinor, currency: ctx.currency },
        { label: "Net", kind: "money", minor: t.netMinor, currency: ctx.currency },
      ],
      period: range,
    }
  },
}
