import {
  type BucketTotals,
  type CategorySpend,
  type DashboardPeriod,
  type DateRange,
  type IsoDate,
  DASHBOARD_PERIODS,
  dashboardRange,
  fillBuckets,
  isIsoDate,
  monthRange,
  topCategories,
} from "@fin-creador/domain"
import type { UserClient } from "../income/client"
import { type Filters, filtersToQuery } from "../transactions/filters"
import type { EntryType } from "../transactions/types"

// The Overview dashboard (Sprint 5): the period in the URL, the breakdown from
// dashboard_breakdown, and links into the Transactions page. Totals come from
// loadTransactionTotals (transaction_summary), so both pages show the same figures.

type Params = { get(name: string): string | null }

/** How each chart is drawn; the defaults are left out of URLs. */
export type ChartChoices = { spending: "bar" | "line"; flow: "bar" | "line"; categories: "bars" | "pie" }

export const DEFAULT_CHARTS: ChartChoices = { spending: "bar", flow: "bar", categories: "bars" }

export const CHART_OPTIONS = {
  spending: [
    { value: "bar", label: "Bar" },
    { value: "line", label: "Line" },
  ],
  flow: [
    { value: "bar", label: "Bar" },
    { value: "line", label: "Line" },
  ],
  categories: [
    { value: "bars", label: "Bars" },
    { value: "pie", label: "Pie" },
  ],
} as const satisfies { [K in keyof ChartChoices]: readonly { value: ChartChoices[K]; label: string }[] }

export type DashboardSelection = { period: DashboardPeriod; range: DateRange; charts: ChartChoices }

function readCharts(params: Params): ChartChoices {
  const pick = <K extends keyof ChartChoices>(key: K): ChartChoices[K] => {
    const raw = params.get(key)
    return (CHART_OPTIONS[key] as readonly { value: string }[]).some((o) => o.value === raw) ? (raw as ChartChoices[K]) : DEFAULT_CHARTS[key]
  }
  return { spending: pick("spending"), flow: pick("flow"), categories: pick("categories") }
}

/**
 * The period and chart types from the URL: ?period=week|month|year|custom (&from=&to= for
 * custom), &spending=line, &flow=line, &categories=pie. Month and bar charts by default.
 */
export function readDashboardParams(params: Params, today: IsoDate): DashboardSelection {
  const charts = readCharts(params)
  const raw = params.get("period")
  const period = DASHBOARD_PERIODS.some((p) => p.value === raw) ? (raw as DashboardPeriod) : "month"
  if (period !== "custom") return { period, range: dashboardRange(period, today), charts }
  const from = params.get("from") ?? ""
  const to = params.get("to") ?? ""
  const custom = isIsoDate(from) && isIsoDate(to) ? { start: from, end: to } : { start: monthRange(today).start, end: today }
  return { period, range: dashboardRange("custom", today, custom), charts }
}

/** Query string for a dashboard view; defaults (month, bar charts) are left out. */
export function dashboardQuery(period: DashboardPeriod, range?: DateRange, charts: ChartChoices = DEFAULT_CHARTS): string {
  const p = new URLSearchParams()
  if (period !== "month") p.set("period", period)
  if (period === "custom" && range) {
    p.set("from", range.start)
    p.set("to", range.end)
  }
  for (const key of ["spending", "flow", "categories"] as const) if (charts[key] !== DEFAULT_CHARTS[key]) p.set(key, charts[key])
  const s = p.toString()
  return s ? `?${s}` : ""
}

/** The Transactions page filtered to a date range (and optionally a type or category). */
export function transactionsHref(range: DateRange, { type, categoryId }: { type?: EntryType; categoryId?: string } = {}): string {
  const filters: Filters = {
    type: type ?? "all",
    period: "custom",
    from: range.start,
    to: range.end,
    category: categoryId ?? "",
    account: "",
    q: "",
    showVoided: false,
  }
  return `/transactions${filtersToQuery(filters)}`
}

export type DashboardBreakdown = {
  /** Every bucket of the range in the profile currency, zeros included. */
  buckets: BucketTotals[]
  /** Top 5 expense categories plus "Everything else" (categoryId null), profile currency. */
  categories: CategorySpend[]
  /** Other currencies with income or expenses in the range: noted, never summed. */
  otherCurrencies: string[]
}

/** Buckets and categories for the range (dashboard_breakdown, as the signed-in user). */
export async function loadDashboardBreakdown(
  supabase: UserClient,
  range: DateRange,
  currency: string,
): Promise<{ ok: true; data: DashboardBreakdown } | { ok: false }> {
  const { data, error } = await supabase.rpc("dashboard_breakdown", { p_from: range.start, p_to: range.end })
  if (error || !Array.isArray(data)) return { ok: false }
  return { ok: true, data: buildBreakdown(data, range, currency) }
}

type BreakdownRow = {
  kind: string
  currency: string
  bucket_start: string | null
  category_id: string | null
  income_minor: number
  expense_minor: number
}

export function buildBreakdown(rows: readonly BreakdownRow[], range: DateRange, currency: string): DashboardBreakdown {
  const same = rows.filter((r) => r.currency === currency)
  return {
    buckets: fillBuckets(
      range,
      same
        .filter((r) => r.kind !== "category" && r.bucket_start)
        .map((r) => ({ start: r.bucket_start as string, incomeMinor: r.income_minor, expenseMinor: r.expense_minor })),
    ),
    categories: topCategories(
      same.filter((r) => r.kind === "category").map((r) => ({ categoryId: r.category_id, expenseMinor: r.expense_minor })),
    ),
    otherCurrencies: [...new Set(rows.filter((r) => r.currency !== currency).map((r) => r.currency))].sort(),
  }
}
