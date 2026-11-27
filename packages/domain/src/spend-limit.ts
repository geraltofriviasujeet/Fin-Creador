// Daily spend limit (decisions log 2026-11-24 "Daily spend limit: final rule" and the plan
// approved 2026-11-27). One overall cap the person chooses: an amount per period of 1 day,
// 1 week, 1 month (the same day each month) or a custom 2–365 days, repeating from starts_on.
//
//   Daily figure = (amount − spent earlier in the period) ÷ days left in the period, today
//   included; rounded down to a whole minor unit, never below 0.
//
// Spending = expenses minus refunds in the profile currency, leaving out entries posted from
// recurring rules and payments of EMIs, card bills, repayments and statutory dues (they are
// bills, already counted in Safe to spend). Transfers are never spending; investments and
// fixed deposits are not ledger entries, so they never appear here. Safe to spend's "spent
// today" (no limit) uses the same definition.
//
// Pure and exact: integer minor units, dates as ISO strings in the profile's time zone.
import { daysBetween } from "./dashboard";
import { type DateRange, type IsoDate, addDays, isInRange, parseIsoDate } from "./dates";
import type { EntryType } from "./ledger";
import { addMinor } from "./money";
import { latestOccurrenceOnOrBefore, nextOccurrenceAfter } from "./recurrence";

export interface SpendLimitRule {
  amountMinor: number;
  period: "day" | "week" | "month" | "custom";
  /** 1 (day), 7 (week), 2–365 (custom); null for a month. */
  periodDays: number | null;
  /** First day of the first period (the person's local date). */
  startsOn: IsoDate;
}

/** A ledger entry as far as spending is concerned. */
export interface SpendEntry {
  type: EntryType;
  amountMinor: number;
  currency: string;
  occurredOn: IsoDate;
  voided: boolean;
  /** Posted from a recurring rule (a bill or subscription): not counted. */
  recurringRuleId: string | null;
  /** Part of an EMI, card bill, repayment or statutory due payment: not counted. */
  paymentId: string | null;
}

export interface SpendLimitToday {
  /** The current period, both ends included. */
  period: DateRange;
  /** Today through the period's last day: at least 1. */
  daysLeft: number;
  /** Spending from the period's first day to yesterday, never below 0. */
  spentEarlierMinor: number;
  /** Spending today, never below 0. */
  spentTodayMinor: number;
  /** (amount − spent earlier) ÷ days left, rounded down; 0 once the period's amount is used. */
  dailyMinor: number;
  /** dailyMinor − spent today (negative once today's spending passes it). */
  leftTodayMinor: number;
}

function checkRule(limit: SpendLimitRule) {
  if (!Number.isSafeInteger(limit.amountMinor) || limit.amountMinor <= 0) throw new RangeError("Limit amount must be a positive safe integer of minor units");
  if (!parseIsoDate(limit.startsOn)) throw new RangeError(`Not an ISO date: ${limit.startsOn}`);
  const days = limit.periodDays;
  const ok =
    (limit.period === "day" && days === 1) ||
    (limit.period === "week" && days === 7) ||
    (limit.period === "month" && days === null) ||
    (limit.period === "custom" && days !== null && Number.isInteger(days) && days >= 2 && days <= 365);
  if (!ok) throw new RangeError("Limit period and day count don't match");
}

/**
 * The period that contains `today`. Day, week and custom periods are runs of N days from
 * starts_on; month periods start on starts_on's day each month (the month's last day when it
 * has fewer days, as monthly recurring dates do). If `today` is before starts_on (the time
 * zone changed since it was set), the period starts today.
 */
export function spendLimitPeriod(limit: SpendLimitRule, today: IsoDate): DateRange {
  checkRule(limit);
  const anchor = today < limit.startsOn ? today : limit.startsOn;
  if (limit.period === "month") {
    const schedule = { frequency: "monthly" as const, startDate: anchor, endDate: null };
    const start = latestOccurrenceOnOrBefore(schedule, today) ?? anchor;
    const next = nextOccurrenceAfter(schedule, today) ?? addDays(start, 1);
    return { start, end: addDays(next, -1) };
  }
  const n = limit.periodDays ?? 1;
  const start = addDays(anchor, Math.floor(daysBetween(anchor, today) / n) * n);
  return { start, end: addDays(start, n - 1) };
}

/** Spending in `range`: expenses minus refunds in `currency`, bills and payments left out, never below 0. */
export function everydaySpendingMinor(entries: readonly SpendEntry[], range: DateRange, currency: string): number {
  const counted = entries.filter(
    (e) => !e.voided && e.currency === currency && e.recurringRuleId === null && e.paymentId === null && isInRange(e.occurredOn, range),
  );
  for (const e of counted) {
    if (!Number.isSafeInteger(e.amountMinor) || e.amountMinor < 0) throw new RangeError("Entry amount must be a non-negative safe integer of minor units");
  }
  const total = addMinor(
    ...counted.map((e) => (e.type === "expense" ? e.amountMinor : e.type === "refund" ? -e.amountMinor : 0)),
  );
  return Math.max(0, total);
}

/**
 * Today's figure for the limit. `entries` must cover the period's first day through today
 * (earlier or later entries are ignored). The limit must already be in `currency`.
 */
export function spendLimitToday(limit: SpendLimitRule, entries: readonly SpendEntry[], today: IsoDate, currency: string): SpendLimitToday {
  const period = spendLimitPeriod(limit, today);
  const daysLeft = daysBetween(today, period.end) + 1;
  const spentEarlierMinor = period.start < today ? everydaySpendingMinor(entries, { start: period.start, end: addDays(today, -1) }, currency) : 0;
  const spentTodayMinor = everydaySpendingMinor(entries, { start: today, end: today }, currency);
  const remaining = addMinor(limit.amountMinor, -spentEarlierMinor);
  const dailyMinor = remaining > 0 ? Number(BigInt(remaining) / BigInt(daysLeft)) : 0;
  return { period, daysLeft, spentEarlierMinor, spentTodayMinor, dailyMinor, leftTodayMinor: addMinor(dailyMinor, -spentTodayMinor) };
}

/**
 * The safety note: the daily limit for every day left in Safe to spend's window is more than
 * the money left after bills. Information only, never blocking.
 */
export function limitExceedsMoneyAfterBills(dailyLimitMinor: number, windowDays: number, moneyAfterBillsMinor: number): boolean {
  return BigInt(dailyLimitMinor) * BigInt(windowDays) > BigInt(moneyAfterBillsMinor);
}
