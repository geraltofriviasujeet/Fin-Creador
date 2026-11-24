// The native Activity tab (Sprint 13b): month chips, the Spent / Received / Transfers chips,
// "More filters", and day groups with day totals. Pure: the screen keeps an ActivityFilters in
// state and passes activityApiFilters(...) to loadTransactionPage and loadTransactionTotals,
// so the database filtering is the same as the web's (toApiFilters).
import { type DateRange, type IsoDate, monthRange, periodTotals, previousMonthRange } from "@fin-creador/domain"
import { ALL_TIME_RANGE, type TypeTab, toApiFilters } from "./filters"
import { monthLabel, rangeText } from "./format"
import type { TransactionFilters } from "./list"
import type { LedgerItem } from "./types"

/** The chips under the month tiles. Refunds are not a chip: they are in More filters. */
export const ACTIVITY_CHIPS = [
  { value: "all", label: "All" },
  { value: "expense", label: "Spent" },
  { value: "income", label: "Received" },
  { value: "transfer", label: "Transfers" },
] as const satisfies readonly { value: TypeTab; label: string }[]
export type ActivityChip = (typeof ACTIVITY_CHIPS)[number]["value"]

/** The chip shown as selected, or null when More filters picked Refunds. */
export function activeChip(type: TypeTab): ActivityChip | null {
  return ACTIVITY_CHIPS.find((c) => c.value === type)?.value ?? null
}

/** How many month chips Activity shows: this month and the five before it (the picker reaches further). */
export const ACTIVITY_MONTH_CHIPS = 6

export type MonthChip = { month: IsoDate; label: string }

/** This month first, then earlier months: "Nov", "Oct", … ("Dec 2025" once the year changes). */
export function monthChips(today: IsoDate, count = ACTIVITY_MONTH_CHIPS): MonthChip[] {
  const chips: MonthChip[] = []
  let month = monthRange(today).start
  for (let i = 0; i < count; i++) {
    chips.push({ month, label: monthLabel(month, today) })
    month = previousMonthRange(month).start
  }
  return chips
}

export type ActivityFilters = {
  /** First day of the chosen month, or null for a custom range (from / to). */
  month: IsoDate | null
  from: IsoDate
  to: IsoDate
  type: TypeTab
  category: string
  account: string
  /** Search text. While set, the list covers all time and the month chips show "All time". */
  q: string
  showVoided: boolean
}

/** Activity as it opens: this month, everything. */
export function initialActivityFilters(today: IsoDate): ActivityFilters {
  const month = monthRange(today)
  return { month: month.start, from: month.start, to: today, type: "all", category: "", account: "", q: "", showVoided: false }
}

/** A month chip or the month picker: that month, other filters kept. */
export function withMonth(f: ActivityFilters, month: IsoDate): ActivityFilters {
  return { ...f, month: monthRange(month).start }
}

/** A custom range from More filters (either order); the month chips show none selected. */
export function withCustomRange(f: ActivityFilters, from: IsoDate, to: IsoDate): ActivityFilters {
  return { ...f, month: null, from: from <= to ? from : to, to: from <= to ? to : from }
}

export const isSearching = (f: Pick<ActivityFilters, "q">) => f.q.trim() !== ""

/** The dates the list and the tiles cover, with the label for them. */
export function activityRange(f: ActivityFilters): { range: DateRange; label: string } {
  if (isSearching(f)) return { range: ALL_TIME_RANGE, label: "All time" }
  if (f.month !== null) return { range: monthRange(f.month), label: monthLabel(f.month) }
  return { range: { start: f.from, end: f.to }, label: rangeText({ start: f.from, end: f.to }) }
}

/** The month before the chosen one, for the savings-rate trend; null for a search or custom range. */
export function activityPreviousRange(f: ActivityFilters): DateRange | null {
  return isSearching(f) || f.month === null ? null : previousMonthRange(f.month)
}

/** The filters as loadTransactionPage and loadTransactionTotals take them. */
export function activityApiFilters(f: ActivityFilters): TransactionFilters {
  const { range } = activityRange(f)
  return toApiFilters({ ...f, q: f.q.trim().slice(0, 100), period: "custom", from: range.start, to: range.end }, range)
}

/** The count on "More filters": category, account, Refunds, show voided, a custom range. */
export function moreFiltersCount(f: ActivityFilters): number {
  return [Boolean(f.category), Boolean(f.account), f.type === "refund", f.showVoided, f.month === null].filter(Boolean).length
}

/** Anything narrowing the list, for "Clear filters" and the no-matches state. */
export function hasActivityFilters(f: ActivityFilters): boolean {
  return f.type !== "all" || moreFiltersCount(f) > 0 || isSearching(f)
}

/** Clear filters: back to the chosen month (this month after a custom range), everything shown. */
export function clearActivityFilters(f: ActivityFilters, today: IsoDate): ActivityFilters {
  const reset = initialActivityFilters(today)
  return f.month === null ? reset : { ...reset, month: f.month }
}

export type DayGroup<T> = {
  date: IsoDate
  rows: T[]
  /**
   * Money in and out that day for the rows shown, in the profile currency (voided rows,
   * transfers and other currencies left out; refunds reduce money out). Null while the day
   * may continue on the next page.
   */
  totals: { inMinor: number; outMinor: number } | null
}

/**
 * Rows grouped by day, newest first as loaded, with day totals. `hasMore`: another page may
 * follow, so the last day is not totalled until it has loaded.
 */
export function dayTotals<T extends LedgerItem>(rows: readonly T[], { currency, hasMore }: { currency: string; hasMore: boolean }): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const row of rows) {
    const last = groups.at(-1)
    if (last?.date === row.occurredOn) last.rows.push(row)
    else groups.push({ date: row.occurredOn, rows: [row], totals: null })
  }
  groups.forEach((group, i) => {
    if (hasMore && i === groups.length - 1) return
    const t = periodTotals(group.rows, { start: group.date, end: group.date }, currency)
    group.totals = { inMinor: t.incomeMinor, outMinor: t.expenseMinor }
  })
  return groups
}
