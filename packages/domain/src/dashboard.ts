// Dashboard periods, comparisons and chart series. Totals and breakdowns come from the
// database (transaction_summary, dashboard_breakdown); this module only picks the date
// ranges, fills the chart buckets and ranks categories, so web and mobile agree.
import { type DateRange, type IsoDate, addDays, daysInMonth, minDate, monthRange, parseIsoDate, yearRange } from "./dates";
import { ratioToBasisPoints } from "./format";
import { addMinor } from "./money";

export type DashboardPeriod = "week" | "month" | "year" | "custom";

export const DASHBOARD_PERIODS: readonly { value: DashboardPeriod; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "custom", label: "Custom" },
];

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function parts(date: IsoDate) {
  const parsed = parseIsoDate(date);
  if (!parsed) throw new RangeError(`Not an ISO date: ${date}`);
  return parsed;
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const x = parts(a);
  const y = parts(b);
  return (Date.UTC(y.year, y.month - 1, y.day) - Date.UTC(x.year, x.month - 1, x.day)) / 86_400_000;
}

/** Number of days in a range, both ends included. */
export const rangeLength = (range: DateRange): number => daysBetween(range.start, range.end) + 1;

/** The Monday-to-Sunday week containing `date`. */
export function weekRange(date: IsoDate): DateRange {
  const { year, month, day } = parts(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  const start = addDays(date, -((weekday + 6) % 7));
  return { start, end: addDays(start, 6) };
}

/** The whole period containing today (or the custom range, ends in either order). */
export function dashboardRange(period: DashboardPeriod, today: IsoDate, custom?: DateRange): DateRange {
  switch (period) {
    case "week":
      return weekRange(today);
    case "year":
      return yearRange(today);
    case "custom":
      if (!custom) return monthRange(today);
      return custom.start <= custom.end ? custom : { start: custom.end, end: custom.start };
    default:
      return monthRange(today);
  }
}

/** The same month and day in another year and month, or that month's last day when shorter. */
function sameDayIn(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

export interface Comparison {
  /** The part of the period that has happened: start to min(end, today). */
  current: DateRange;
  /** The same elapsed span of the previous period (or the same length just before a custom range). */
  previous: DateRange;
  /** e.g. "vs same days last month". */
  label: string;
}

/**
 * What the period is compared with. Week, month and year compare the days so far with the
 * same days of the previous week, month or year (31 March compares with up to 28 or 29
 * February; 29 February with 28 February). A custom range compares with the same number
 * of days immediately before it. Returns null when the period starts after today.
 */
export function comparisonFor(period: DashboardPeriod, range: DateRange, today: IsoDate): Comparison | null {
  if (range.start > today) return null;
  const current = { start: range.start, end: minDate(range.end, today) };
  const end = parts(current.end);
  switch (period) {
    case "week":
      return {
        current,
        previous: { start: addDays(current.start, -7), end: addDays(current.end, -7) },
        label: "vs same days last week",
      };
    case "month": {
      const year = end.month === 1 ? end.year - 1 : end.year;
      const month = end.month === 1 ? 12 : end.month - 1;
      return {
        current,
        previous: { start: `${pad(year, 4)}-${pad(month)}-01`, end: sameDayIn(year, month, end.day) },
        label: "vs same days last month",
      };
    }
    case "year":
      return {
        current,
        previous: { start: `${pad(end.year - 1, 4)}-01-01`, end: sameDayIn(end.year - 1, end.month, end.day) },
        label: "vs same days last year",
      };
    default: {
      const length = rangeLength(current);
      return {
        current,
        previous: { start: addDays(current.start, -length), end: addDays(current.start, -1) },
        label: `vs previous ${length} ${length === 1 ? "day" : "days"}`,
      };
    }
  }
}

/** Change from `previous` to `current` in basis points; null when previous is 0 (shown as "—"). */
export function changeBasisPoints(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ratioToBasisPoints(addMinor(current, -previous), Math.abs(previous));
}

/** Difference of two rates in basis points (percentage points ×100); null if either is missing. */
export function pointsChange(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

export type BucketSize = "day" | "month";

/**
 * Ranges up to 62 days are charted by day, longer ones by month. The database function
 * dashboard_breakdown applies the same rule; keep the two in step.
 */
export const MAX_DAY_BUCKETS = 62;

export const bucketSizeFor = (range: DateRange): BucketSize => (rangeLength(range) <= MAX_DAY_BUCKETS ? "day" : "month");

export interface BucketTotals {
  /** First day of the bucket (the day itself, or the 1st of the month). */
  start: IsoDate;
  incomeMinor: number;
  expenseMinor: number;
}

/** Every bucket of the range in order, with zeros where nothing was recorded. */
export function fillBuckets(range: DateRange, rows: readonly BucketTotals[]): BucketTotals[] {
  const byStart = new Map(rows.map((r) => [r.start, r]));
  const out: BucketTotals[] = [];
  if (bucketSizeFor(range) === "day") {
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
      out.push(byStart.get(d) ?? { start: d, incomeMinor: 0, expenseMinor: 0 });
    }
    return out;
  }
  for (let start = monthRange(range.start).start; start <= range.end; start = addDays(monthRange(start).end, 1)) {
    out.push(byStart.get(start) ?? { start, incomeMinor: 0, expenseMinor: 0 });
  }
  return out;
}

export interface CategorySpend {
  /** null for the "Everything else" row. */
  categoryId: string | null;
  expenseMinor: number;
}

/**
 * The largest `limit` categories by spending (ties by id, so the order is stable) and one
 * "Everything else" row (categoryId null) for the rest, if any. Zero rows are dropped.
 */
export function topCategories(rows: readonly CategorySpend[], limit = 5): CategorySpend[] {
  const sorted = rows
    .filter((r) => r.expenseMinor > 0)
    .sort((a, b) => b.expenseMinor - a.expenseMinor || String(a.categoryId).localeCompare(String(b.categoryId)));
  if (sorted.length <= limit) return sorted;
  const rest = addMinor(...sorted.slice(limit).map((r) => r.expenseMinor));
  return [...sorted.slice(0, limit), { categoryId: null, expenseMinor: rest }];
}
