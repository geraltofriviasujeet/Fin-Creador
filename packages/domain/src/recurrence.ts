// Recurring rules (Sprint 4). Due items are computed from the rules; nothing posts by
// itself (decisions 2026-10-23, A–L). Calendar dates only (YYYY-MM-DD), no time zones:
// "today" is the user's local date from the database.
//
//   Occurrences are anchored to the start date: occurrence n of a monthly rule that
//   starts on 31 Jan falls on 28/29 Feb, 31 Mar, 30 Apr, ... (the anchor day, or the
//   month's last day when the month is shorter). Weekly adds 7n days; quarterly 3n
//   months; yearly n years (29 Feb falls on 28 Feb in other years).
//   An occurrence counts only within start..min(end, today).
//   Only the latest occurrence that is due can be shown; a posted (not voided) or
//   skipped occurrence is handled. Voiding a posted entry makes it due again.
import { type IsoDate, addDays, daysInMonth, parseIsoDate } from "./dates";

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";

export const FREQUENCIES: readonly { value: Frequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Every 3 months" },
  { value: "yearly", label: "Yearly" },
];

export interface Schedule {
  frequency: Frequency;
  startDate: IsoDate;
  /** Last day an occurrence may fall on (inclusive), or null for no end. */
  endDate: IsoDate | null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function mustParse(date: IsoDate) {
  const p = parseIsoDate(date);
  if (!p) throw new Error(`Not a calendar date: ${date}`);
  return p;
}

const dayNumber = (date: IsoDate) => {
  const { year, month, day } = mustParse(date);
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

const MONTHS: Record<Exclude<Frequency, "weekly">, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Occurrence `n` (0 = the start date) of the schedule, ignoring the end date. */
export function occurrence(schedule: Pick<Schedule, "frequency" | "startDate">, n: number): IsoDate {
  if (!Number.isInteger(n) || n < 0) throw new Error("Occurrence index must be a whole number from 0");
  if (schedule.frequency === "weekly") return addDays(schedule.startDate, 7 * n);
  const { year, month, day } = mustParse(schedule.startDate);
  const index = year * 12 + (month - 1) + n * MONTHS[schedule.frequency];
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${pad(y, 4)}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

/** Index of the latest occurrence on or before `date`, or null if the schedule starts later. */
function latestIndex(schedule: Pick<Schedule, "frequency" | "startDate">, date: IsoDate): number | null {
  if (date < schedule.startDate) return null;
  let n: number;
  if (schedule.frequency === "weekly") {
    n = Math.floor((dayNumber(date) - dayNumber(schedule.startDate)) / 7);
  } else {
    const s = mustParse(schedule.startDate);
    const d = mustParse(date);
    n = Math.floor((d.year * 12 + d.month - (s.year * 12 + s.month)) / MONTHS[schedule.frequency]);
  }
  while (n > 0 && occurrence(schedule, n) > date) n--;
  return n;
}

/** The latest occurrence within start..min(end, `date`), or null. */
export function latestOccurrenceOnOrBefore(schedule: Schedule, date: IsoDate): IsoDate | null {
  const limit = schedule.endDate && schedule.endDate < date ? schedule.endDate : date;
  const n = latestIndex(schedule, limit);
  return n === null ? null : occurrence(schedule, n);
}

/** The first occurrence after `date` (strictly later), or null once the schedule has ended. */
export function nextOccurrenceAfter(schedule: Schedule, date: IsoDate): IsoDate | null {
  const n = latestIndex(schedule, date);
  const next = occurrence(schedule, n === null ? 0 : n + 1);
  return schedule.endDate && next > schedule.endDate ? null : next;
}

/** Occurrences from `from` to `to` (inclusive), within the schedule. */
export function occurrencesBetween(schedule: Schedule, from: IsoDate, to: IsoDate): IsoDate[] {
  const end = schedule.endDate && schedule.endDate < to ? schedule.endDate : to;
  const result: IsoDate[] = [];
  const first = latestIndex(schedule, from);
  for (let n = first === null ? 0 : first; ; n++) {
    const d = occurrence(schedule, n);
    if (d > end) break;
    if (d >= from) result.push(d);
  }
  return result;
}

/** Whether `date` is an occurrence of the schedule (the database checks the same on posting). */
export function isOccurrence(schedule: Schedule, date: IsoDate): boolean {
  return latestOccurrenceOnOrBefore(schedule, date) === date;
}

export type RecurringStatus =
  | { kind: "due"; date: IsoDate }
  | { kind: "needs_attention"; date: IsoDate | null }
  | { kind: "upcoming"; date: IsoDate }
  | { kind: "ended" }
  | { kind: "archived" };

/**
 * Where a rule stands on `today`. `handled` holds the occurrence dates already posted (by a
 * non-voided entry) or skipped. A rule whose account or category is archived needs
 * attention before it can post.
 */
export function recurringStatus(
  rule: Schedule & { archived: boolean; blocked: boolean },
  today: IsoDate,
  handled: ReadonlySet<IsoDate>,
): RecurringStatus {
  if (rule.archived) return { kind: "archived" };
  const latest = latestOccurrenceOnOrBefore(rule, today);
  const due = latest && !handled.has(latest) ? latest : null;
  const next = nextOccurrenceAfter(rule, today);
  if (rule.blocked) return { kind: "needs_attention", date: due ?? next };
  if (due) return { kind: "due", date: due };
  if (next) return { kind: "upcoming", date: next };
  return { kind: "ended" };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Weekly on Thursday", "Monthly on day 31", "Every 3 months on day 5", "Yearly on 29 Feb". */
export function scheduleText(schedule: Pick<Schedule, "frequency" | "startDate">): string {
  const { year, month, day } = mustParse(schedule.startDate);
  switch (schedule.frequency) {
    case "weekly":
      return `Weekly on ${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}`;
    case "monthly":
      return `Monthly on day ${day}`;
    case "quarterly":
      return `Every 3 months on day ${day}`;
    case "yearly":
      return `Yearly on ${day} ${MONTH_NAMES[month - 1]}`;
  }
}

/** Whether some months are shorter than the anchor day (the occurrence moves to the month's last day). */
export const anchorDayMayMove = (schedule: Pick<Schedule, "frequency" | "startDate">) =>
  schedule.frequency !== "weekly" && mustParse(schedule.startDate).day > 28;

// ---------------------------------------------------------------------------
// Recurring cost (estimated from the rules' default amounts)
// ---------------------------------------------------------------------------
//   Active expense rules only: not income, not transfers, not ended or archived.
//   Yearly = amount × occurrences per year (weekly 52, monthly 12, quarterly 4, yearly 1).
//   Monthly = yearly / 12, rounded half up, from each tile's yearly total. Integer minor
//   units throughout; each currency is totalled separately, never converted.

export const OCCURRENCES_PER_YEAR: Readonly<Record<Frequency, number>> = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };

export const yearlyCostMinor = (amountMinor: number, frequency: Frequency): number => amountMinor * OCCURRENCES_PER_YEAR[frequency];

/** yearly / 12, rounded half up (for the non-negative amounts here). */
export const monthlyFromYearlyMinor = (yearlyMinor: number): number => Math.floor((yearlyMinor + 6) / 12);

export type CostGroup = "subscription" | "membership" | "other";

export interface CostRule {
  type: "income" | "expense" | "transfer";
  amountMinor: number;
  currency: string;
  frequency: Frequency;
  group: CostGroup;
  /** False once the rule has ended or is archived. */
  active: boolean;
}

export interface CostTotal {
  yearlyMinor: number;
  monthlyMinor: number;
  count: number;
}

export interface RecurringCosts {
  currency: string;
  subscriptions: CostTotal;
  memberships: CostTotal;
  total: CostTotal;
}

/** Cost tiles per currency, sorted by currency code. */
export function recurringCosts(rules: readonly CostRule[]): RecurringCosts[] {
  const byCurrency = new Map<string, { subscription: number[]; membership: number[]; all: number[] }>();
  for (const r of rules) {
    if (r.type !== "expense" || !r.active) continue;
    const bucket = byCurrency.get(r.currency) ?? { subscription: [], membership: [], all: [] };
    const yearly = yearlyCostMinor(r.amountMinor, r.frequency);
    if (r.group !== "other") bucket[r.group].push(yearly);
    bucket.all.push(yearly);
    byCurrency.set(r.currency, bucket);
  }
  const total = (values: number[]): CostTotal => {
    const yearlyMinor = values.reduce((sum, v) => sum + v, 0);
    if (!Number.isSafeInteger(yearlyMinor)) throw new Error("Recurring cost is too large to total exactly");
    return { yearlyMinor, monthlyMinor: monthlyFromYearlyMinor(yearlyMinor), count: values.length };
  };
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, b]) => ({ currency, subscriptions: total(b.subscription), memberships: total(b.membership), total: total(b.all) }));
}
