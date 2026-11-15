// The goal "what if" (Sprint 10.7a): one change to one goal, worked out on the goal check's own
// projection (goal-projection.ts, same rules and inputs), before and after. Exact integer
// arithmetic, savings only: no investment returns, no interest, no inflation. Only this goal
// changes; the other goals, loan payments and dues are taken as they are today.
//
// Changes:
//  - monthly: save a fixed amount more (or less) every month, on top of what is free. With the
//    change at zero, `after` is exactly goalProjection's result. Saving less that leaves this
//    month's saving at zero or below: not reached, no date. Saving more when nothing is free this
//    month (zero or below): each month's free money counts from zero (`floored`), so the amount
//    is what goes to the goal a month, found from outside the records.
//  - cost: the goal costs a fixed amount more (or less). Zero or below: nothing left to save,
//    no projection. With the change at zero, `after` is exactly goalProjection's result.
//  - by_month: the amount a month needed to reach it by a month (that month counted). Two
//    figures: the flat amount (what is still needed over the months, rounded up), and the least
//    extra a month, on top of the free money the projection finds, that reaches it in that month
//    or earlier (zero when the free money already does). A month before this one is refused.
//    When nothing is free this month, free money counts from zero as above (`floored`): with
//    nothing free in any month, the extra is the flat amount.
//
// Parsing (what the person typed, never the model): amounts "5000", "5,000", "5k", "5 hazaar",
// "2 lakh"; months "Dec 2027", "December 2027", "by next June", "in 18 months", "2 saal mein".
// Anything else is not parsed, and the caller asks.
import { type IsoDate, parseIsoDate } from "./dates";
import { type GoalProjection, type GoalProjectionInput, PROJECTION_HORIZON_MONTHS, freeByMonth, goalProjection } from "./goal-projection";
import { rupeeAmountsIn } from "./income-tax";
import { addMinor } from "./money";
import { monthStart } from "./reports";

export type WhatIfChange = { kind: "monthly"; deltaMinor: number } | { kind: "cost"; deltaMinor: number } | { kind: "by_month"; month: IsoDate };

export type WhatIfOutcome =
  /** The goal's target is 0: nothing to work out. */
  | "no_target"
  /** by_month: the month is before this one. */
  | "past_month"
  /** cost: the change takes the cost to zero or below. */
  | "no_cost_left"
  /** Saved already (for cost: at the changed cost). */
  | "reached"
  /** Fewer than 3 months with records: no figure. */
  | "too_early"
  /** Not reached within the projection's horizon, or saving nothing at all after the change. */
  | "not_reached"
  | "projected";

export interface ByMonth {
  month: IsoDate;
  /** From this month to `month`, both counted. */
  months: number;
  /** What is still needed over those months, rounded up to the minor unit. */
  neededMonthlyMinor: number;
  /** Least extra a month on top of the free money that reaches it by `month`; 0 when none is needed. */
  extraMonthlyMinor: number;
  /** Free money added up from this month to `month`. */
  availableMinor: number;
}

export interface GoalWhatIf {
  outcome: WhatIfOutcome;
  /** The goal as it is; null when it has no target. */
  before: GoalProjection | null;
  /** monthly and cost: the projection with the change; by_month: with the extra a month. Null when nothing was projected. */
  after: GoalProjection | null;
  byMonth: ByMonth | null;
  /** Nothing was free this month, so free money was counted from zero (see above). */
  floored: boolean;
}

/** Months from the month of `from` to the month of `to` (same month = 0). */
function monthIndex(from: IsoDate, to: IsoDate): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) throw new RangeError("Not an ISO date");
  return b.year * 12 + b.month - (a.year * 12 + a.month);
}

/** ceil(num / den) for den > 0. */
const ceilDiv = (num: number, den: number) => {
  const n = BigInt(num);
  const d = BigInt(den);
  const q = n / d;
  return Number(n % d > 0n ? q + 1n : q);
};

const outcomeOf = (p: GoalProjection): WhatIfOutcome =>
  p.plan.basis === "reached" ? "reached" : p.medianNetMinor === null ? "too_early" : p.reachMonth === null ? "not_reached" : "projected";

export function goalWhatIf(input: GoalProjectionInput, change: WhatIfChange): GoalWhatIf {
  const none = { after: null, byMonth: null, floored: false };
  if (input.targetMinor === 0) return { outcome: "no_target", before: null, ...none };
  const before = goalProjection(input);
  const nothingFree = before.freeThisMonthMinor !== null && before.freeThisMonthMinor <= 0;

  if (change.kind === "monthly") {
    if (!Number.isSafeInteger(change.deltaMinor)) throw new RangeError("Amounts must be whole minor units");
    const floored = nothingFree && change.deltaMinor > 0;
    const after = goalProjection({ ...input, adjustMonthlyMinor: addMinor(input.adjustMonthlyMinor ?? 0, change.deltaMinor), ...(floored ? { floorFreeAtZero: true } : {}) });
    const outcome = outcomeOf(before);
    if (outcome === "reached" || outcome === "too_early") return { outcome, before, after, byMonth: null, floored: false };
    // Saving less that leaves nothing a month for this goal: not reached, no date.
    if (change.deltaMinor < 0 && addMinor(before.freeThisMonthMinor!, change.deltaMinor) <= 0) {
      return { outcome: "not_reached", before, after: { ...after, verdict: "no", reachMonth: null }, byMonth: null, floored: false };
    }
    return { outcome: outcomeOf(after), before, after, byMonth: null, floored };
  }

  if (change.kind === "cost") {
    const targetMinor = addMinor(input.targetMinor, change.deltaMinor);
    if (targetMinor <= 0) return { outcome: "no_cost_left", before, ...none };
    const after = goalProjection({ ...input, targetMinor });
    return { outcome: outcomeOf(after), before, after, byMonth: null, floored: false };
  }

  const months = monthIndex(input.today, change.month) + 1;
  if (months < 1) return { outcome: "past_month", before, ...none };
  if (before.plan.basis === "reached") return { outcome: "reached", before, ...none };
  const floor = nothingFree ? { floorFreeAtZero: true } : {};
  const free = freeByMonth({ ...input, ...floor }, months);
  if (free === null) return { outcome: "too_early", before, ...none };
  const remaining = before.plan.remainingMinor;
  // The least extra x with running[i] + (i + 1)·x ≥ remaining for some month i up to `month`.
  let running = 0;
  let extra = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < months; i++) {
    running = addMinor(running, free[i]!);
    extra = Math.min(extra, Math.max(0, ceilDiv(remaining - running, i + 1)));
  }
  const after = goalProjection({ ...input, ...floor, adjustMonthlyMinor: addMinor(input.adjustMonthlyMinor ?? 0, extra) });
  return {
    outcome: "projected",
    floored: nothingFree,
    before,
    after,
    byMonth: { month: monthStart(change.month), months, neededMonthlyMinor: ceilDiv(remaining, months), extraMonthlyMinor: extra, availableMinor: running },
  };
}

// ---------------------------------------------------------------------------
// What the person typed
// ---------------------------------------------------------------------------

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const NAMED = new RegExp(`\\b${MONTH}\\.?,?\\s+(\\d{4})\\b`, "gi");
const NEXT = new RegExp(`\\bnext\\s+${MONTH}\\b`, "gi");
const IN_MONTHS = /\b(?:in\s+)?(\d{1,3})\s+(months?|mahine|mahina|mahino|years?|yrs?|saal|sal)\b(?:\s+(?:mein|me|main|mai))?/gi;

const monthNumber = (name: string) => MONTH_NAMES.indexOf(name.slice(0, 3).toLowerCase()) + 1;
const firstOf = (year: number, month: number): IsoDate => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;

/**
 * Every target month written in a text, as the first day of that month. "next June": the next
 * June after this month. "in 18 months", "18 months mein": the month 18 months after this one;
 * "2 saal mein", "in 2 years": 24 months after. A count needs "in" or "mein" with it.
 */
export function whatIfMonthsIn(text: string, today: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (const m of text.matchAll(NAMED)) {
    const year = Number(m[2]);
    if (year >= 1900 && year <= 2200) out.push(firstOf(year, monthNumber(m[1]!)));
  }
  const now = monthStart(today);
  for (const m of text.matchAll(NEXT)) {
    const wanted = monthNumber(m[1]!);
    const current = Number(now.slice(5, 7));
    out.push(monthStart(now, wanted > current ? wanted - current : wanted - current + 12));
  }
  for (const m of text.matchAll(IN_MONTHS)) {
    if (!/^in\s|\s(?:mein|me|main|mai)$/i.test(m[0]!)) continue;
    const count = Number(m[1]);
    const n = /^(?:m|mahin)/i.test(m[2]!) ? count : count * 12;
    if (n >= 1 && n <= PROJECTION_HORIZON_MONTHS * 2) out.push(monthStart(now, n));
  }
  return [...new Set(out)];
}

const HAZAAR = /(\d)\s*(?:hazaa?r|hajaa?r)\b/gi;

/**
 * Every whole-rupee amount written in a text ("5000", "5,000", "5k", "5 hazaar", "2 lakh"),
 * leaving out the years and counts of any month written with it.
 */
export function whatIfAmountsIn(text: string): number[] {
  const withoutMonths = text.replace(NAMED, " ").replace(NEXT, " ").replace(IN_MONTHS, " ").replace(HAZAAR, "$1 thousand");
  return [...new Set(rupeeAmountsIn(withoutMonths).map((a) => a.rupees))];
}
