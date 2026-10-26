// Goals (planned expenses) and monthly budgets: exact arithmetic only. No prices, no
// estimates; every figure comes from what the person entered.
//
// Units: money in integer minor units, interest in basis points a year (850 = 8.5%),
// tenure in whole months.
// Rounding (one rule): each derived amount is computed exactly with integers and rounded
// once, half away from zero, to the minor unit, the same rule as ratioToBasisPoints.
import { addMinor } from "./money";
import { ratioToBasisPoints } from "./format";
import { parseIsoDate, type IsoDate } from "./dates";

/** Exact num / den rounded half away from zero (den > 0). */
export function divRoundHalfAway(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError("Denominator must be positive");
  const q = (num * 2n) / den;
  return (q + (q >= 0n ? 1n : -1n)) / 2n;
}

function toSafe(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError("Amount is too large to be exact");
  return n;
}

function checkMinor(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
}

/** `amountMinor` × `basisPoints` / 10,000, e.g. a 20% down payment on a price. */
export function percentOfMinor(amountMinor: number, basisPoints: number): number {
  checkMinor(amountMinor, "Amount");
  checkMinor(basisPoints, "Basis points");
  return toSafe(divRoundHalfAway(BigInt(amountMinor) * BigInt(basisPoints), 10_000n));
}

// ---------------------------------------------------------------------------
// Loans and EMIs
// ---------------------------------------------------------------------------

export interface EmiInput {
  principalMinor: number;
  /** Yearly interest in basis points; 0 for a no-cost EMI. */
  annualRateBps: number;
  months: number;
}

export interface EmiResult {
  /** Monthly instalment, rounded once. */
  emiMinor: number;
  /** Exact EMI × months − principal, rounded once (0 for a no-cost EMI). */
  totalInterestMinor: number;
  /** principal + total interest. */
  totalPayableMinor: number;
}

export const MAX_TENURE_MONTHS = 480;
export const MAX_RATE_BPS = 10_000;

/**
 * Reducing-balance EMI with monthly rest: P·r·(1+r)^n / ((1+r)^n − 1), r = rate / 12.
 * With r = bps / 120,000 this is exactly P·bps·A^n / (120,000·(A^n − B^n)), A = 120,000 +
 * bps, B = 120,000, so the whole calculation stays in integers until the final rounding.
 * Real lenders may differ by a few minor units (their own rounding, last-instalment fix).
 */
export function emi({ principalMinor, annualRateBps, months }: EmiInput): EmiResult {
  checkMinor(principalMinor, "Principal");
  checkMinor(annualRateBps, "Interest rate");
  if (!Number.isInteger(months) || months < 1 || months > MAX_TENURE_MONTHS) throw new RangeError("Tenure out of range");
  if (annualRateBps > MAX_RATE_BPS) throw new RangeError("Interest rate out of range");
  const p = BigInt(principalMinor);
  const n = BigInt(months);
  if (annualRateBps === 0) {
    const emiMinor = toSafe(divRoundHalfAway(p, n));
    return { emiMinor, totalInterestMinor: 0, totalPayableMinor: principalMinor };
  }
  const bps = BigInt(annualRateBps);
  const b = 120_000n;
  const an = (b + bps) ** n;
  const bn = b ** n;
  const num = p * bps * an;
  const den = b * (an - bn);
  const emiMinor = toSafe(divRoundHalfAway(num, den));
  // Total interest from the exact EMI: (num·n − p·den) / den.
  const totalInterestMinor = toSafe(divRoundHalfAway(num * n - p * den, den));
  return { emiMinor, totalInterestMinor, totalPayableMinor: addMinor(principalMinor, totalInterestMinor) };
}

// ---------------------------------------------------------------------------
// Monthly saving needed
// ---------------------------------------------------------------------------

/** Months assumed when a goal has no target date (shown to the person as an assumption). */
export const NO_DATE_ASSUMED_MONTHS = 12;

/** Calendar months from today's month to the target's month, both counted (same month = 1). */
export function monthsToTarget(today: IsoDate, target: IsoDate): number {
  const a = parseIsoDate(today);
  const b = parseIsoDate(target);
  if (!a || !b) throw new RangeError("Not an ISO date");
  return b.year * 12 + b.month - (a.year * 12 + a.month) + 1;
}

export type SavingBasis =
  /** Goal reached: nothing left to save. */
  | "reached"
  /** Spread over the months to the target date. */
  | "target_date"
  /** No target date: spread over NO_DATE_ASSUMED_MONTHS. */
  | "assumed_months"
  /** The target month has passed: everything left is needed now. */
  | "past_due";

export interface SavingPlan {
  remainingMinor: number;
  /** Months the remainder is spread over (0 when reached). */
  months: number;
  monthlyMinor: number;
  basis: SavingBasis;
  /** saved / target in basis points (may exceed 10,000); null when the target is 0. */
  progressBps: number | null;
}

export function savingPlan(input: {
  targetMinor: number;
  savedMinor: number;
  targetDate: IsoDate | null;
  today: IsoDate;
}): SavingPlan {
  const { targetMinor, savedMinor, targetDate, today } = input;
  checkMinor(targetMinor, "Target");
  checkMinor(savedMinor, "Saved amount");
  const progressBps = ratioToBasisPoints(savedMinor, targetMinor);
  const remainingMinor = Math.max(0, targetMinor - savedMinor);
  if (remainingMinor === 0) return { remainingMinor, months: 0, monthlyMinor: 0, basis: "reached", progressBps };
  let months: number;
  let basis: SavingBasis;
  if (targetDate === null) {
    months = NO_DATE_ASSUMED_MONTHS;
    basis = "assumed_months";
  } else {
    months = monthsToTarget(today, targetDate);
    basis = "target_date";
    if (months < 1) {
      months = 1;
      basis = "past_due";
    }
  }
  const monthlyMinor = toSafe(divRoundHalfAway(BigInt(remainingMinor), BigInt(months)));
  return { remainingMinor, months, monthlyMinor, basis, progressBps };
}

// ---------------------------------------------------------------------------
// Monthly budgets
// ---------------------------------------------------------------------------

export interface BudgetRow {
  categoryId: string;
  /** First day of the month the amount applies from. */
  effectiveFrom: IsoDate;
  amountMinor: number;
  currency: string;
}

/**
 * The budget per category for the month containing `month`: the latest row at or before
 * that month. An amount of 0 means "no budget from that month on" and is left out.
 */
export function budgetsForMonth(rows: readonly BudgetRow[], month: IsoDate): Map<string, BudgetRow> {
  const monthStart = `${month.slice(0, 7)}-01`;
  const latest = new Map<string, BudgetRow>();
  for (const row of rows) {
    if (row.effectiveFrom > monthStart) continue;
    const current = latest.get(row.categoryId);
    if (!current || row.effectiveFrom > current.effectiveFrom) latest.set(row.categoryId, row);
  }
  for (const [id, row] of latest) if (row.amountMinor === 0) latest.delete(id);
  return latest;
}

export const BUDGET_WARNING_BPS = 8_000;
export const BUDGET_OVER_BPS = 10_000;

export type BudgetLevel = "ok" | "warning" | "over";

export interface BudgetStatus {
  spentMinor: number;
  budgetMinor: number;
  /** spent / budget in basis points (exact comparison decides the level). */
  usedBps: number;
  leftMinor: number;
  level: BudgetLevel;
}

/** Warning at 80% of the budget or more, over at 100% or more (exact, not rounded). */
export function budgetStatus(spentMinor: number, budgetMinor: number): BudgetStatus {
  checkMinor(spentMinor, "Spent");
  checkMinor(budgetMinor, "Budget");
  if (budgetMinor === 0) throw new RangeError("Budget must be more than zero");
  const spent = BigInt(spentMinor) * 10_000n;
  const budget = BigInt(budgetMinor);
  const level: BudgetLevel =
    spent >= budget * BigInt(BUDGET_OVER_BPS) ? "over" : spent >= budget * BigInt(BUDGET_WARNING_BPS) ? "warning" : "ok";
  return {
    spentMinor,
    budgetMinor,
    usedBps: ratioToBasisPoints(spentMinor, budgetMinor) ?? 0,
    leftMinor: budgetMinor - spentMinor,
    level,
  };
}

// ---------------------------------------------------------------------------
// Planned expenses: stored answers and the figures derived from them
// ---------------------------------------------------------------------------
// The answers are stored as the goal's `details` (validated per type in packages/schemas,
// version `v` so later sprints, such as AI insights, can read them safely).

export const GOAL_TYPES = ["trip", "car", "house", "furniture", "electronics", "mobile", "other"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const TRIP_COST_LINES = ["transport", "stay", "food", "activities", "visaInsurance", "shopping", "buffer"] as const;
export type TripCostLine = (typeof TRIP_COST_LINES)[number];

export type LoanPayment = "cash" | "loan" | "loan_down_payment";
export type ItemPayment = "cash" | "emi" | "no_cost_emi";

export interface TripDetails {
  v: 1;
  scope: "domestic" | "international";
  /** State (domestic) or country (international). */
  place: string;
  people: number;
  days: number;
  travelMode: "flight" | "train" | "bus" | "car" | "other";
  stay: "hotel" | "homestay" | "hostel" | "friends_family" | "other";
  costs: Record<TripCostLine, number>;
}

export interface CarDetails {
  v: 1;
  condition: "new" | "used";
  model: string;
  payment: LoanPayment;
  priceMinor: number;
  /** Registration, insurance, accessories: paid upfront, never financed here. */
  extrasMinor: number;
  /** loan_down_payment only. */
  downPaymentMinor: number | null;
  /** Loans only. */
  loanRateBps: number | null;
  loanMonths: number | null;
}

export interface HouseDetails {
  v: 1;
  purpose: "buy" | "renovate";
  city: string;
  payment: LoanPayment;
  priceMinor: number;
  downPaymentMinor: number | null;
  loanRateBps: number | null;
  loanMonths: number | null;
}

export interface ItemDetails {
  v: 1;
  item: string;
  payment: ItemPayment;
  priceMinor: number;
  /** emi only (no-cost EMI is 0). */
  emiRateBps: number | null;
  /** emi and no_cost_emi. */
  emiMonths: number | null;
}

export interface OtherDetails {
  v: 1;
  description: string;
}

export type GoalDetails =
  | { type: "trip"; details: TripDetails }
  | { type: "car"; details: CarDetails }
  | { type: "house"; details: HouseDetails }
  | { type: "furniture" | "electronics" | "mobile"; details: ItemDetails }
  | { type: "other"; details: OtherDetails };

export interface GoalLoan extends EmiResult {
  principalMinor: number;
  annualRateBps: number;
  months: number;
}

export interface GoalFigures {
  /** What has to be saved before the target date (the goal's target amount). Null for "other": entered directly. */
  upfrontMinor: number | null;
  /** Trip only: the sum of the cost lines. */
  costTotalMinor: number | null;
  /** The financed part, when there is one. */
  loan: GoalLoan | null;
}

function loanFigures(principalMinor: number, annualRateBps: number | null, months: number | null): GoalLoan {
  if (months === null) throw new RangeError("Loan tenure is required");
  const rate = annualRateBps ?? 0;
  return { principalMinor, annualRateBps: rate, months, ...emi({ principalMinor, annualRateBps: rate, months }) };
}

function financed(payment: LoanPayment, priceMinor: number, downPaymentMinor: number | null) {
  if (payment === "cash") return { upfront: priceMinor, principal: 0 };
  const down = payment === "loan_down_payment" ? (downPaymentMinor ?? 0) : 0;
  if (down > priceMinor) throw new RangeError("Down payment is more than the price");
  return { upfront: down, principal: priceMinor - down };
}

/**
 * Upfront amount, cost total and loan for a planned expense:
 *  - trip: upfront = the sum of the cost lines;
 *  - car: cash → price + extras; loan → extras, the price financed; loan with down payment
 *    → down payment + extras, price − down payment financed;
 *  - house: as car without extras;
 *  - furniture, electronics, mobile: cash → price; EMI or no-cost EMI → nothing upfront,
 *    the price financed (no-cost EMI at 0%);
 *  - other: the amount entered is the target.
 */
export function goalFigures(goal: GoalDetails): GoalFigures {
  switch (goal.type) {
    case "trip": {
      const total = addMinor(...TRIP_COST_LINES.map((line) => goal.details.costs[line]));
      return { upfrontMinor: total, costTotalMinor: total, loan: null };
    }
    case "car":
    case "house": {
      const d = goal.details;
      const extras = goal.type === "car" ? goal.details.extrasMinor : 0;
      const { upfront, principal } = financed(d.payment, d.priceMinor, d.downPaymentMinor);
      return {
        upfrontMinor: addMinor(upfront, extras),
        costTotalMinor: null,
        loan: principal > 0 ? loanFigures(principal, d.loanRateBps, d.loanMonths) : null,
      };
    }
    case "furniture":
    case "electronics":
    case "mobile": {
      const d = goal.details;
      if (d.payment === "cash") return { upfrontMinor: d.priceMinor, costTotalMinor: null, loan: null };
      const rate = d.payment === "no_cost_emi" ? 0 : d.emiRateBps;
      return { upfrontMinor: 0, costTotalMinor: null, loan: loanFigures(d.priceMinor, rate, d.emiMonths) };
    }
    case "other":
      return { upfrontMinor: null, costTotalMinor: null, loan: null };
  }
}
