import { z } from "zod"
import { loadDashboardBreakdown } from "@fin-creador/api"
import { addMinor, formatMoney } from "@fin-creador/domain"
import { periodData, periodFields, periodRangeOrThrow } from "./period"
import { type FinanceTool, type Figure, ToolError } from "./types"

// category_breakdown (Sprint 10.2): spending by category for a period (dashboard_breakdown).
// Unfiltered, it is the Overview's categories chart (topCategories): the top 5 expense
// categories net of refunds plus "Everything else", and categories where refunds were more
// than the spending. With a category asked for by name, every category whose name contains
// the words asked for ("food" finds "Food & dining") is returned with its own figure, never
// folded into "Everything else".

export const OTHER_CATEGORIES = "Everything else"

const input = z
  .object({
    ...periodFields,
    category: z
      .string()
      .trim()
      .max(60)
      .optional()
      .describe("Only categories whose name contains these words, e.g. 'food' finds 'Food & dining'. Leave out for the full breakdown."),
  })
  .strict()

export type CategoryInput = z.infer<typeof input>

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/** Whether a category name contains every word asked for (case-insensitive, any order). */
export function categoryMatches(name: string, asked: string): boolean {
  const wanted = words(asked)
  const have = name.toLowerCase()
  return wanted.length > 0 && wanted.every((w) => have.includes(w))
}

/**
 * The categories whose name contains the words asked for (category_breakdown and
 * search_transactions). None: a ToolError that lists the person's active categories, so they
 * can see what to ask for.
 */
export function matchCategories<C extends { name: string; archived_at: string | null }>(all: readonly C[], asked: string): C[] {
  const matched = all.filter((c) => categoryMatches(c.name, asked))
  if (matched.length > 0) return matched
  const existing = all.filter((c) => c.archived_at === null).map((c) => c.name)
  throw new ToolError(`No category name contains "${asked}". The person's categories are: ${existing.join(", ") || "none"}.`)
}

export const categoryBreakdownTool: FinanceTool<CategoryInput> = {
  name: "category_breakdown",
  description:
    "Spending by category for a period, in the person's own currency (expenses minus refunds). Without category: the five largest categories and 'Everything else'. With category: each category whose name contains those words, with its own figure.",
  input,
  async run(ctx, p) {
    const range = periodRangeOrThrow(p, ctx.today)
    const [breakdown, names] = await Promise.all([
      loadDashboardBreakdown(ctx.supabase, range, ctx.currency),
      ctx.supabase.from("categories").select("id, name, archived_at").eq("kind", "expense"),
    ])
    if (!breakdown.ok || names.error) throw new ToolError("The category figures couldn't be loaded.")
    const nameOf = new Map(names.data.map((c) => [c.id, c.name]))
    const label = (id: string | null) => (id === null ? OTHER_CATEGORIES : (nameOf.get(id) ?? "Uncategorised"))
    const money = (minor: number) => formatMoney(minor, { currency: ctx.currency })
    const { categories, refunded, byCategory, otherCurrencies } = breakdown.data

    if (p.category) {
      const asked = p.category
      const matched = matchCategories(names.data, asked)
      const rows = matched
        .map((c) => ({ name: c.name, minor: addMinor(...byCategory.filter((r) => r.categoryId === c.id).map((r) => r.expenseMinor)) }))
        .sort((a, b) => b.minor - a.minor || a.name.localeCompare(b.name))
      return {
        data: {
          period: periodData(range),
          currency: ctx.currency,
          asked_for: asked,
          categories: rows.map((r) => ({ category: r.name, spent: money(r.minor) })),
          other_currencies: otherCurrencies,
          note:
            rows.length > 1
              ? "Several categories match: each is given on its own. Spending is expenses minus refunds; below zero means refunds were more."
              : "Spending is expenses minus refunds; below zero means refunds were more. Entries in other currencies are left out, never converted.",
        },
        figures: [...rows.map((r): Figure => ({ label: r.name, kind: "money", minor: r.minor, currency: ctx.currency })), { label: "Categories matched", kind: "count", value: rows.length }],
        period: range,
      }
    }

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
