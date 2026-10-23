// Filters for the Transactions prototype, read from and written to the URL so links, the
// back button and the topbar search work. In Phase 2 the same filters run in the database.
import {
  type DateRange,
  type IsoDate,
  currentVersions,
  isIsoDate,
  monthRange,
  parseAmount,
  previousMonthRange,
  yearRange,
} from "@fin-creador/domain"
import type { DemoAccount, DemoCategory, DemoEntry } from "./demo-data"

export const TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfers" },
] as const
export type TypeTab = (typeof TYPE_TABS)[number]["value"]

export const PERIODS = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-year", label: "This year" },
  { value: "custom", label: "Custom range" },
] as const
export type Period = (typeof PERIODS)[number]["value"]

export type Filters = {
  type: TypeTab
  period: Period
  from: IsoDate
  to: IsoDate
  category: string
  account: string
  q: string
  showVoided: boolean
}

type Params = { get(name: string): string | null }

const oneOf = <T extends string>(values: readonly { value: T }[], v: string | null, fallback: T): T =>
  values.some((x) => x.value === v) ? (v as T) : fallback

export function readFilters(params: Params, today: IsoDate): Filters {
  const period = oneOf(PERIODS, params.get("period"), "this-month")
  const month = monthRange(today)
  const from = params.get("from") ?? ""
  const to = params.get("to") ?? ""
  return {
    type: oneOf(TYPE_TABS, params.get("type"), "all"),
    period,
    from: isIsoDate(from) ? from : month.start,
    to: isIsoDate(to) ? to : today,
    category: params.get("category") ?? "",
    account: params.get("account") ?? "",
    q: (params.get("q") ?? "").trim().slice(0, 100),
    showVoided: params.get("voided") === "1",
  }
}

/** Query string for a filter change; defaults are left out to keep URLs short. */
export function filtersToQuery(f: Filters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  if (f.type !== "all") p.set("type", f.type)
  if (f.period !== "this-month") p.set("period", f.period)
  if (f.period === "custom") {
    p.set("from", f.from)
    p.set("to", f.to)
  }
  if (f.category) p.set("category", f.category)
  if (f.account) p.set("account", f.account)
  if (f.q) p.set("q", f.q)
  if (f.showVoided) p.set("voided", "1")
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ""
}

/** The date range for the chosen period, in the user's calendar (today comes from the database in Phase 2). */
export function periodRange(f: Pick<Filters, "period" | "from" | "to">, today: IsoDate): DateRange {
  switch (f.period) {
    case "last-month":
      return previousMonthRange(today)
    case "this-year":
      return yearRange(today)
    case "custom":
      return f.from <= f.to ? { start: f.from, end: f.to } : { start: f.to, end: f.from }
    default:
      return monthRange(today)
  }
}

export function periodLabel(f: Pick<Filters, "period">): string {
  return PERIODS.find((p) => p.value === f.period)?.label ?? "This month"
}

/** The period before, for "from last month" trends; only month presets have one. */
export function previousPeriod(f: Pick<Filters, "period">, today: IsoDate): DateRange | null {
  if (f.period === "this-month") return previousMonthRange(today)
  if (f.period === "last-month") return previousMonthRange(previousMonthRange(today).start)
  return null
}

export type Lookup = { accounts: Map<string, DemoAccount>; categories: Map<string, DemoCategory> }

/**
 * Search: case-insensitive text in the note, category and account names; or, when the
 * query reads as an amount ("2480", "2,480", "₹2,480.00"), the exact amount.
 */
export function matchesSearch(entry: DemoEntry, q: string, lookup: Lookup, currency = "INR"): boolean {
  if (!q) return true
  const needle = q.toLocaleLowerCase("en-IN")
  const haystack = [
    entry.note,
    entry.categoryId ? lookup.categories.get(entry.categoryId)?.name : null,
    lookup.accounts.get(entry.accountId)?.label,
    entry.counterAccountId ? lookup.accounts.get(entry.counterAccountId)?.label : null,
  ]
  if (haystack.some((text) => text?.toLocaleLowerCase("en-IN").includes(needle))) return true
  const amount = parseAmount(q.replace(/[₹\s]/g, ""), currency)
  return amount.ok && amount.minor === entry.amountMinor
}

/**
 * Entries matching every filter except the type tab: the summary cards use these (so
 * Income and Expenses stay visible on any tab). Only the latest version of an edited
 * entry is considered.
 */
export function filterForSummary(entries: readonly DemoEntry[], f: Filters, range: DateRange, lookup: Lookup): DemoEntry[] {
  return currentVersions(entries).filter(
    (e) =>
      e.occurredOn >= range.start &&
      e.occurredOn <= range.end &&
      (!f.category || e.categoryId === f.category) &&
      (!f.account || e.accountId === f.account || e.counterAccountId === f.account) &&
      matchesSearch(e, f.q, lookup)
  )
}

/** Rows for the list: the summary set narrowed by the type tab; voided rows only on request. Newest first. */
export function filterForList(summarySet: readonly DemoEntry[], f: Filters): DemoEntry[] {
  return summarySet
    .filter((e) => (f.type === "all" || e.type === f.type) && (f.showVoided || !e.voided))
    .sort((a, b) => (a.occurredOn === b.occurredOn ? b.createdAt.localeCompare(a.createdAt) : b.occurredOn.localeCompare(a.occurredOn)))
}

export function hasActiveFilters(f: Filters): boolean {
  return f.type !== "all" || f.period !== "this-month" || Boolean(f.category || f.account || f.q) || f.showVoided
}

/** Group rows by date, keeping order. */
export function groupByDay<T extends { occurredOn: IsoDate }>(rows: readonly T[]): { date: IsoDate; rows: T[] }[] {
  const groups: { date: IsoDate; rows: T[] }[] = []
  for (const row of rows) {
    const last = groups.at(-1)
    if (last?.date === row.occurredOn) last.rows.push(row)
    else groups.push({ date: row.occurredOn, rows: [row] })
  }
  return groups
}
