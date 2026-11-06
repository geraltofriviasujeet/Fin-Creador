// The goal check (Sprint 10.4): can a goal be reached at the person's current rate, by when,
// and what would have to change. Exact integer arithmetic only, computed here and never by a
// model; Roma only puts the result into words.
//
// Rules:
//  - Rate: the median monthly net (income − spending, as the Reports page shows it, in the
//    profile currency only) over the last PROJECTION_MEASURED_MONTHS complete calendar months.
//    The current month is partial and is left out. A month with no income and no spending is
//    treated as not tracked and is not counted as a zero. An even count takes the mean of the
//    middle two, rounded once, half away from zero.
//  - Fewer than PROJECTION_MIN_MONTHS tracked months: no projection ("too early").
//  - Free money in month i (0 = this month) = the median − claims falling in that month −
//    each other goal's monthly saving (savingPlan) for its months. Claims dated before this
//    month count this month; claims beyond the horizon are ignored.
//  - The goal is reached in the first month the running total of free money covers what is
//    left. A month with less than nothing free reduces the running total.
//  - Horizon: PROJECTION_HORIZON_MONTHS months from this month, both counted, or up to the
//    target month when that is later.
import { type IsoDate, parseIsoDate } from "./dates";
import { type SavingPlan, divRoundHalfAway, savingPlan } from "./goals";
import { addMinor } from "./money";
import { monthStart } from "./reports";

export const PROJECTION_MEASURED_MONTHS = 6;
export const PROJECTION_MIN_MONTHS = 3;
export const PROJECTION_HORIZON_MONTHS = 120;

export type GoalVerdict = "yes" | "no" | "too_early";

export interface MeasuredMonth {
  incomeMinor: number;
  expenseMinor: number;
}

/** Money that must be paid in a month (a loan's principal, a statutory due). */
export interface ProjectionClaim {
  date: IsoDate;
  amountMinor: number;
}

export interface GoalProjectionInput {
  today: IsoDate;
  targetMinor: number;
  savedMinor: number;
  targetDate: IsoDate | null;
  /** The complete months measured, any order (at most PROJECTION_MEASURED_MONTHS are used by the caller). */
  months: readonly MeasuredMonth[];
  claims: readonly ProjectionClaim[];
  /** Each other active goal's saving plan (savingPlan): monthlyMinor for its `months`. */
  otherGoals: readonly Pick<SavingPlan, "monthlyMinor" | "months">[];
}

export interface GoalProjection {
  verdict: GoalVerdict;
  plan: SavingPlan;
  /** Tracked months the median came from. */
  monthsMeasured: number;
  /** PROJECTION_MIN_MONTHS to PROJECTION_MEASURED_MONTHS − 1 tracked months: say how few. */
  thin: boolean;
  /** Null below PROJECTION_MIN_MONTHS. */
  medianNetMinor: number | null;
  /** This month's claims (loans, dues) and other goals' saving. */
  claimsThisMonthMinor: number;
  otherGoalsThisMonthMinor: number;
  /** Free for this goal this month (may be below zero); null without a median. */
  freeThisMonthMinor: number | null;
  /** First day of the month the goal is reached at the current rate; null when not within the horizon or no projection. */
  reachMonth: IsoDate | null;
  /** How much more a month would reach it by the target month (or, without a date, within the horizon); null when not needed or no projection. */
  extraMonthlyMinor: number | null;
  /** Free money added up from this month to the target month, both counted (the trip check, 10.5); null without a target date or projection. */
  availableByTargetMinor: number | null;
}

/** Median of whole minor amounts; the mean of the middle two for an even count, rounded half away from zero. */
export function medianMinor(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("No values");
  for (const v of values) if (!Number.isSafeInteger(v)) throw new RangeError("Amounts must be whole minor units");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Number(divRoundHalfAway(BigInt(sorted[mid - 1]!) + BigInt(sorted[mid]!), 2n));
}

/** Months from the month of `from` to the month of `to` (same month = 0). */
function monthIndex(from: IsoDate, to: IsoDate): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) throw new RangeError("Not an ISO date");
  return b.year * 12 + b.month - (a.year * 12 + a.month);
}

/** ceil(num / den) for num ≥ 0, den > 0. */
const ceilDiv = (num: number, den: number) => Number((BigInt(num) + BigInt(den) - 1n) / BigInt(den));

export function goalProjection(input: GoalProjectionInput): GoalProjection {
  const { today, targetDate } = input;
  const plan = savingPlan({ targetMinor: input.targetMinor, savedMinor: input.savedMinor, targetDate, today });
  const tracked = input.months.filter((m) => m.incomeMinor !== 0 || m.expenseMinor !== 0);
  const monthsMeasured = tracked.length;
  const horizon = plan.basis === "target_date" ? Math.max(PROJECTION_HORIZON_MONTHS, plan.months) : PROJECTION_HORIZON_MONTHS;

  const claims = new Array<number>(horizon).fill(0);
  for (const c of input.claims) {
    if (!Number.isSafeInteger(c.amountMinor) || c.amountMinor < 0) throw new RangeError("Claims must be non-negative minor units");
    const i = Math.max(0, monthIndex(today, c.date));
    if (i < horizon) claims[i] = addMinor(claims[i]!, c.amountMinor);
  }
  const others = new Array<number>(horizon).fill(0);
  for (const g of input.otherGoals) {
    for (let i = 0; i < Math.min(g.months, horizon); i++) others[i] = addMinor(others[i]!, g.monthlyMinor);
  }

  const base = {
    plan,
    monthsMeasured,
    thin: monthsMeasured >= PROJECTION_MIN_MONTHS && monthsMeasured < PROJECTION_MEASURED_MONTHS,
    claimsThisMonthMinor: claims[0]!,
    otherGoalsThisMonthMinor: others[0]!,
  };
  const none = { reachMonth: null, extraMonthlyMinor: null, availableByTargetMinor: null };

  if (plan.basis === "reached") {
    return { ...base, ...none, verdict: "yes", medianNetMinor: null, freeThisMonthMinor: null };
  }
  if (monthsMeasured < PROJECTION_MIN_MONTHS) {
    return { ...base, ...none, verdict: plan.basis === "past_due" ? "no" : "too_early", medianNetMinor: null, freeThisMonthMinor: null };
  }

  const median = medianMinor(tracked.map((m) => addMinor(m.incomeMinor, -m.expenseMinor)));
  const free = claims.map((c, i) => addMinor(median, -c, -others[i]!));
  const running: number[] = [];
  let reachIndex: number | null = null;
  for (let i = 0; i < horizon; i++) {
    running.push(addMinor(running[i - 1] ?? 0, free[i]!));
    if (reachIndex === null && running[i]! >= plan.remainingMinor) reachIndex = i;
  }
  const reachMonth = reachIndex === null ? null : monthStart(today, reachIndex);
  const extraBy = (months: number) => {
    const short = plan.remainingMinor - running[months - 1]!;
    return short > 0 ? ceilDiv(short, months) : null;
  };
  const availableByTargetMinor = plan.basis === "target_date" ? running[plan.months - 1]! : null;
  const projected = { ...base, medianNetMinor: median, freeThisMonthMinor: free[0]!, reachMonth, availableByTargetMinor };

  switch (plan.basis) {
    case "past_due":
      return { ...projected, verdict: "no", extraMonthlyMinor: null };
    case "assumed_months":
      return { ...projected, verdict: reachIndex === null ? "no" : "yes", extraMonthlyMinor: reachIndex === null ? extraBy(PROJECTION_HORIZON_MONTHS) : null };
    case "target_date": {
      const onTime = reachIndex !== null && reachIndex < plan.months;
      return { ...projected, verdict: onTime ? "yes" : "no", extraMonthlyMinor: onTime ? null : extraBy(plan.months) };
    }
  }
}
