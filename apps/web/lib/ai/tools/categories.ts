import { loadDashboardBreakdown } from "@fin-creador/api"
import { formatMoney } from "@fin-creador/domain"
import { type PeriodInput, periodData, periodInput, periodRangeOrThrow } from "./period"
import { type FinanceTool, type Figure, ToolError } from "./types"

// category_breakdown (Sprint 10.2): spending by category for a period, the Overview's
// categories chart (dashboard_breakdown, topCategories): the top 5 expense categories net of
// refunds plus "Everything else", and categories where refunds were more than the spending.

export const OTHER_CATEGORIES = "Everything else"

export const categoryBreakdownTool: FinanceTool<PeriodInput> = {
  name: "category_breakdown",
  description:
    "Spending by category for a period: the five largest expense categories (expenses minus refunds) and 'Everything else', in the person's own currency.",
  input: periodInput,
  async run(ctx, p) {
    const range = periodRangeOrThrow(p, ctx.today)
    const [breakdown, names] = await Promise.all([
      loadDashboardBreakdown(ctx.supabase, range, ctx.currency),
      ctx.supabase.from("categories").select("id, name").eq("kind", "expense"),
    ])
    if (!breakdown.ok || names.error) throw new ToolError("The category figures couldn't be loaded.")
    const nameOf = new Map(names.data.map((c) => [c.id, c.name]))
    const label = (id: string | null) => (id === null ? OTHER_CATEGORIES : (nameOf.get(id) ?? "Uncategorised"))
    const money = (minor: number) => formatMoney(minor, { currency: ctx.currency })
    const { categories, refunded, otherCurrencies } = breakdown.data

    const figures: Figure[] = [
      ...categories.map((c): Figure => ({ label: label(c.categoryId), kind: "money", minor: c.expenseMinor, currency: ctx.currency })),
      ...refunded.map((c): Figure => ({ label: `${label(c.categoryId)} (refunds over spending)`, kind: "money", minor: c.expenseMinor, currency: ctx.currency })),
    ]
    return {
      data: {
        period: periodData(range),
        currency: ctx.currency,
        categories: categories.map((c) => ({ category: label(c.categoryId), spent: money(c.expenseMinor) })),
        refunds_over_spending: refunded.map((c) => ({ category: label(c.categoryId), net: money(c.expenseMinor) })),
        other_currencies: otherCurrencies,
        note:
          categories.length === 0
            ? "No spending was recorded in this period."
            : "Largest first. Spending is expenses minus refunds. Entries in other currencies are left out, never converted.",
      },
      figures,
      period: range,
    }
  },
}
