import { type TransactionTotals, beforeOpeningTotals, loadEntriesBeforeOriginalOpening, loadTransactionTotals } from "@fin-creador/api"
import { formatMoney, formatPercentFromBasisPoints, savingsRateBasisPoints } from "@fin-creador/domain"
import { type PeriodInput, periodData, periodInput, periodRangeOrThrow } from "./period"
import { type FinanceTool, type ToolContext, ToolError } from "./types"

// income_vs_expenses and savings_rate (Sprint 10.2): the Overview's income, spent, net and
// savings-rate figures (transaction_summary; savingsRateBasisPoints in packages/domain).
// Transfers are neither income nor spending; other currencies are counted, never converted.
// Entries dated before their account's original opening date (a statement's earlier payments,
// added by moving the opening back) are left out: those days have no income recorded, so they
// would read as overspending (original-opening.ts in packages/api). When nothing is left in the
// period but such entries, the tools say income for it is not recorded.

/** The totals without the entries before their account's original opening date, and how many those were. */
export function totalsWithoutBefore(totals: TransactionTotals, left: ReturnType<typeof beforeOpeningTotals>, leftOutOther: number): TransactionTotals {
  const incomeMinor = totals.incomeMinor - left.incomeMinor
  const expenseMinor = totals.expenseMinor - left.expenseMinor
  return {
    ...totals,
    incomeMinor,
    expenseMinor,
    refundMinor: totals.refundMinor - left.refundMinor,
    netMinor: incomeMinor - expenseMinor,
    incomeCount: totals.incomeCount - left.incomeCount,
    expenseCount: totals.expenseCount - left.expenseCount,
    refundCount: totals.refundCount - left.refundCount,
    otherCurrencyCount: totals.otherCurrencyCount - leftOutOther,
  }
}

async function totalsFor(ctx: ToolContext, p: PeriodInput) {
  const range = periodRangeOrThrow(p, ctx.today)
  const [result, before] = await Promise.all([
    loadTransactionTotals(ctx.supabase, { from: range.start, to: range.end }, ctx.currency),
    loadEntriesBeforeOriginalOpening(ctx.supabase, range.start, range.end),
  ])
  if (!result.ok || !before.ok) throw new ToolError("The income and spending figures couldn't be loaded.")
  const left = beforeOpeningTotals(before.entries, ctx.currency)
  const leftOut = before.entries.length
  const totals = totalsWithoutBefore(result.totals, left, before.entries.filter((e) => e.currency !== ctx.currency).length)
  const recorded = totals.incomeCount + totals.expenseCount + totals.refundCount + totals.transferCount + totals.otherCurrencyCount
  return { range, totals, leftOut, onlyImported: leftOut > 0 && recorded === 0 }
}

const leftOutNote = (n: number) =>
  `${n === 1 ? "1 entry" : `${n} entries`} in this period ${n === 1 ? "is" : "are"} dated before tracking of ${n === 1 ? "its" : "their"} account began (added from a statement, with no income recorded for those days) and ${n === 1 ? "is" : "are"} left out.`
const NOT_RECORDED = "Income for this period is not recorded: its only entries were added from a statement, before tracking of their account began. So there is no savings rate or net for it."

const NOTE = "spent is expenses minus refunds; net is income minus spent. Transfers between own accounts are left out. Entries in other currencies are counted, not included or converted."

export const incomeVsExpensesTool: FinanceTool<PeriodInput> = {
  name: "income_vs_expenses",
  description: "Income, spending (expenses minus refunds) and the difference (net) for a period, in the person's own currency, with entry counts.",
  input: periodInput,
  async run(ctx, p) {
    const { range, totals: t, leftOut, onlyImported } = await totalsFor(ctx, p)
    const money = (minor: number) => formatMoney(minor, { currency: ctx.currency })
    if (onlyImported) return notRecorded(ctx, range)
    return {
      data: {
        period: periodData(range),
        currency: ctx.currency,
        ...(leftOut > 0 ? { left_out: leftOutNote(leftOut) } : {}),
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
    const { range, totals: t, leftOut, onlyImported } = await totalsFor(ctx, p)
    if (onlyImported) return notRecorded(ctx, range)
    const bps = savingsRateBasisPoints(t)
    const money = (minor: number) => formatMoney(minor, { currency: ctx.currency })
    return {
      data: {
        period: periodData(range),
        currency: ctx.currency,
        ...(leftOut > 0 ? { left_out: leftOutNote(leftOut) } : {}),
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

/** A period whose only entries are before their account's original opening: no figures, the reason said. */
function notRecorded(ctx: ToolContext, range: ReturnType<typeof periodRangeOrThrow>) {
  return { data: { period: periodData(range), currency: ctx.currency, income_recorded: false, note: NOT_RECORDED }, figures: [], period: range }
}
