// Loans (Sprint 8a): EMI estimate, schedule, moratorium interest and the default split of a
// payment. Exact integer maths, each derived amount rounded once, half away from zero (the
// goals.ts rule). The database stores what the person entered and the EMI; every figure
// here is derived, never computed in SQL.
//
// Units: money in integer minor units, interest in basis points a year (850 = 8.5%), months
// as whole numbers. One month's interest on a balance B is B × bps / 120,000 (a twelfth of
// the yearly rate, reducing balance with monthly rest, as Indian lenders quote EMIs).
//
// Outstanding principal is the loan's liability account: owed = −(account balance). A
// payment's principal is a transfer into that account; interest and fees are expenses.
import { addMonthsClamped } from "./fixed-deposits";
import { type IsoDate, isIsoDate } from "./dates";
import { MAX_RATE_BPS, MAX_TENURE_MONTHS, divRoundHalfAway, emi } from "./goals";
import { MAX_AMOUNT_MINOR, addMinor } from "./money";

export const LOAN_TYPES = [
  "home",
  "vehicle",
  "personal",
  "education",
  "gold",
  "business",
  "consumer",
  "property_securities",
  "credit_card_emi",
  "other",
] as const;
export type LoanType = (typeof LOAN_TYPES)[number];

export const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  home: "Home loan",
  vehicle: "Vehicle loan",
  personal: "Personal loan",
  education: "Education loan",
  gold: "Gold loan",
  business: "Business loan",
  consumer: "Consumer / EMI loan",
  property_securities: "Loan against property or securities",
  credit_card_emi: "Credit card EMI",
  other: "Other",
};

export const LOAN_RATE_KINDS = ["fixed", "floating"] as const;
export type LoanRateKind = (typeof LOAN_RATE_KINDS)[number];

/** Ongoing: EMIs are being paid. Starts later: the first EMI is in the future (e.g. education). */
export const LOAN_START_MODES = ["ongoing", "starts_later"] as const;
export type LoanStartMode = (typeof LOAN_START_MODES)[number];

/** During a moratorium, interest is added to the loan when EMIs start, or paid every month. */
export const MORATORIUM_INTEREST = ["capitalise", "pay_monthly"] as const;
export type MoratoriumInterest = (typeof MORATORIUM_INTEREST)[number];

export const LOAN_MAX_TENURE_MONTHS = MAX_TENURE_MONTHS;
export const LOAN_MAX_RATE_BPS = MAX_RATE_BPS;
export const LOAN_MAX_MORATORIUM_MONTHS = 120;
/** Characters after trimming (the database checks the same). */
export const LOAN_LENDER_MAX = 80;
export const LOAN_NICKNAME_MAX = 40;
export const LOAN_TYPE_OTHER_MAX = 40;

function toSafe(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError("Amount is too large to be exact");
  return n;
}

function checkMinor(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT_MINOR) throw new RangeError(`${name} out of range`);
}

function checkRate(rateBps: number) {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > LOAN_MAX_RATE_BPS) throw new RangeError("Interest rate out of range");
}

/** One month's interest on `balanceMinor`: balance × bps / 120,000, rounded once. */
export function monthlyInterestMinor(balanceMinor: number, rateBps: number): number {
  checkMinor(balanceMinor, "Balance");
  checkRate(rateBps);
  return toSafe(divRoundHalfAway(BigInt(balanceMinor) * BigInt(rateBps), 120_000n));
}

/** Simple (not compounded) interest for whole months: principal × bps × months / 120,000, rounded once. */
export function simpleInterestMinor(principalMinor: number, rateBps: number, months: number): number {
  checkMinor(principalMinor, "Principal");
  checkRate(rateBps);
  if (!Number.isInteger(months) || months < 0 || months > LOAN_MAX_MORATORIUM_MONTHS) throw new RangeError("Months out of range");
  return toSafe(divRoundHalfAway(BigInt(principalMinor) * BigInt(rateBps) * BigInt(months), 120_000n));
}

// ---------------------------------------------------------------------------
// EMI estimate
// ---------------------------------------------------------------------------

export type LoanTerms =
  | {
      startMode: "ongoing";
      /** Principal still owed today (after any EMI already paid). */
      outstandingMinor: number;
      rateBps: number;
      /** EMIs left, counted from the next one due. */
      remainingMonths: number;
    }
  | {
      startMode: "starts_later";
      /** Amount taken (disbursed). */
      disbursedMinor: number;
      rateBps: number;
      /** Number of EMIs once repayment starts. */
      tenureMonths: number;
      moratoriumMonths: number;
      /** Null when there is no moratorium. */
      moratoriumInterest: MoratoriumInterest | null;
    };

export interface EmiEstimate {
  /** The calculated EMI (an estimate: the bank's own EMI may differ and can overwrite it). */
  emiMinor: number;
  /** Principal the EMIs repay: outstanding (ongoing) or disbursed + capitalised interest. */
  principalMinor: number;
  /** Moratorium interest added to the loan when EMIs start (0 unless capitalised). */
  capitalisedMinor: number;
  /** Interest paid each month during the moratorium (0 unless paid monthly). */
  moratoriumMonthlyInterestMinor: number;
  months: number;
}

/**
 * EMI for the loan as entered (the goals.ts reducing-balance formula, exact, rounded once):
 *  - ongoing: on the outstanding principal over the EMIs left;
 *  - starts later: on the amount taken plus, when capitalised, simple interest for the
 *    moratorium months (added when EMIs start), over the tenure. Interest paid monthly
 *    during the moratorium is a separate interest-only instalment each month.
 */
export function loanEmiEstimate(terms: LoanTerms): EmiEstimate {
  if (terms.startMode === "ongoing") {
    checkMinor(terms.outstandingMinor, "Outstanding");
    const { emiMinor } = emi({ principalMinor: terms.outstandingMinor, annualRateBps: terms.rateBps, months: terms.remainingMonths });
    return { emiMinor, principalMinor: terms.outstandingMinor, capitalisedMinor: 0, moratoriumMonthlyInterestMinor: 0, months: terms.remainingMonths };
  }
  const { disbursedMinor, rateBps, tenureMonths, moratoriumMonths, moratoriumInterest } = terms;
  checkMinor(disbursedMinor, "Amount taken");
  if (moratoriumMonths > 0 && moratoriumInterest === null) throw new RangeError("Say what happens to interest during the moratorium");
  const capitalisedMinor = moratoriumInterest === "capitalise" ? simpleInterestMinor(disbursedMinor, rateBps, moratoriumMonths) : 0;
  const moratoriumMonthlyInterestMinor =
    moratoriumMonths > 0 && moratoriumInterest === "pay_monthly" ? monthlyInterestMinor(disbursedMinor, rateBps) : 0;
  const principalMinor = addMinor(disbursedMinor, capitalisedMinor);
  const { emiMinor } = emi({ principalMinor, annualRateBps: rateBps, months: tenureMonths });
  return { emiMinor, principalMinor, capitalisedMinor, moratoriumMonthlyInterestMinor, months: tenureMonths };
}

/** The smallest EMI that repays any principal in the first month: one month's interest + 1. */
export function minimumEmiMinor(principalMinor: number, rateBps: number): number {
  return monthlyInterestMinor(principalMinor, rateBps) + 1;
}

// ---------------------------------------------------------------------------
// Instalment dates
// ---------------------------------------------------------------------------

/** Due date of EMI number `seq` (1-based): first due date + (seq − 1) months, month-end clamped, from the first date. */
export function instalmentDate(firstDueDate: IsoDate, seq: number): IsoDate {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError("Instalment number must be 1 or more");
  return addMonthsClamped(firstDueDate, seq - 1);
}

/**
 * Interest-only instalments of a moratorium paid monthly: one a month for the moratorium
 * months, the last one month before the first EMI (month-end clamped, counted from it).
 */
export function moratoriumDates(firstEmiDate: IsoDate, moratoriumMonths: number): IsoDate[] {
  if (!isIsoDate(firstEmiDate)) throw new RangeError("Not an ISO date");
  if (!Number.isInteger(moratoriumMonths) || moratoriumMonths < 0 || moratoriumMonths > LOAN_MAX_MORATORIUM_MONTHS) {
    throw new RangeError("Moratorium out of range");
  }
  return Array.from({ length: moratoriumMonths }, (_, i) => addMonthsClamped(firstEmiDate, i - moratoriumMonths));
}

/**
 * Ongoing loan, "this month's EMI": already paid → it is recorded as before tracking (never
 * posted), dated one month before the next due date; still due → the next due date is that
 * EMI and it is pending. Null when there is nothing to record.
 */
export function beforeTrackingDate(nextDueDate: IsoDate, thisMonthPaid: boolean): IsoDate | null {
  return thisMonthPaid ? addMonthsClamped(nextDueDate, -1) : null;
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export interface ScheduleInput {
  principalMinor: number;
  rateBps: number;
  /** The EMI in use: the estimate, or the bank's EMI the person entered. */
  emiMinor: number;
  /** Most EMIs the schedule may have (EMIs left or the tenure). */
  months: number;
  firstDueDate: IsoDate;
}

export interface ScheduleRow {
  seq: number;
  dueDate: IsoDate;
  amountMinor: number;
  interestMinor: number;
  principalMinor: number;
  /** Principal still owed after this instalment. */
  closingMinor: number;
}

/**
 * The repayment schedule for an EMI (reducing balance, monthly rest). Each month's interest
 * is one month on the balance, rounded once; the rest of the EMI repays principal. The
 * schedule follows the EMI it is given:
 *  - an EMI above the estimate finishes early: the instalment that would overpay is the last
 *    and clears exactly what is left (balance + that month's interest);
 *  - at the last allowed month the instalment clears what is left, so a lower EMI leaves a
 *    larger last instalment (a bank's own rounding shows up here as a small difference).
 * An EMI that doesn't cover a month's interest (before the last) is refused.
 */
export function loanSchedule({ principalMinor, rateBps, emiMinor, months, firstDueDate }: ScheduleInput): ScheduleRow[] {
  checkMinor(principalMinor, "Principal");
  checkRate(rateBps);
  checkMinor(emiMinor, "EMI");
  if (emiMinor < 1) throw new RangeError("EMI must be more than zero");
  if (!Number.isInteger(months) || months < 1 || months > LOAN_MAX_TENURE_MONTHS) throw new RangeError("Tenure out of range");
  if (!isIsoDate(firstDueDate)) throw new RangeError("Not an ISO date");
  const rows: ScheduleRow[] = [];
  let balance = principalMinor;
  for (let seq = 1; balance > 0 && seq <= months; seq += 1) {
    const interestMinor = monthlyInterestMinor(balance, rateBps);
    const dueDate = instalmentDate(firstDueDate, seq);
    const clears = addMinor(balance, interestMinor);
    if (seq === months || clears <= emiMinor) {
      rows.push({ seq, dueDate, amountMinor: clears, interestMinor, principalMinor: balance, closingMinor: 0 });
      break;
    }
    if (emiMinor <= interestMinor) throw new RangeError("EMI does not cover the monthly interest");
    const principalPart = emiMinor - interestMinor;
    balance -= principalPart;
    rows.push({ seq, dueDate, amountMinor: emiMinor, interestMinor, principalMinor: principalPart, closingMinor: balance });
  }
  return rows;
}

export interface ScheduleTotals {
  instalments: number;
  totalInterestMinor: number;
  totalPayableMinor: number;
  lastDueDate: IsoDate | null;
}

export function scheduleTotals(rows: readonly ScheduleRow[]): ScheduleTotals {
  return {
    instalments: rows.length,
    totalInterestMinor: addMinor(...rows.map((r) => r.interestMinor)),
    totalPayableMinor: addMinor(...rows.map((r) => r.amountMinor)),
    lastDueDate: rows.at(-1)?.dueDate ?? null,
  };
}

// ---------------------------------------------------------------------------
// Paying an instalment
// ---------------------------------------------------------------------------

export interface PaymentSplit {
  principalMinor: number;
  interestMinor: number;
  feesMinor: number;
  /** Leaves the paying account: principal + interest + fees. */
  totalMinor: number;
}

/**
 * The split offered when paying an instalment (the person may change every part):
 *  - interest-only (moratorium paid monthly): all of it is interest;
 *  - EMI: one month's interest on what is owed, the rest principal. When that would repay
 *    more than is owed, or it is the last instalment, it clears exactly what is owed (+ the
 *    month's interest). An instalment smaller than the interest is all interest.
 * `outstandingMinor` includes moratorium interest still to be added to the loan.
 */
export function defaultPaymentSplit(input: {
  kind: "emi" | "interest_only";
  amountDueMinor: number;
  outstandingMinor: number;
  rateBps: number;
  isLast: boolean;
}): PaymentSplit {
  const { kind, amountDueMinor, outstandingMinor, rateBps, isLast } = input;
  checkMinor(amountDueMinor, "Amount due");
  checkMinor(outstandingMinor, "Outstanding");
  if (kind === "interest_only") return { principalMinor: 0, interestMinor: amountDueMinor, feesMinor: 0, totalMinor: amountDueMinor };
  const interest = monthlyInterestMinor(outstandingMinor, rateBps);
  const clears = addMinor(outstandingMinor, interest);
  if (isLast || clears <= amountDueMinor) return { principalMinor: outstandingMinor, interestMinor: interest, feesMinor: 0, totalMinor: clears };
  if (amountDueMinor <= interest) return { principalMinor: 0, interestMinor: amountDueMinor, feesMinor: 0, totalMinor: amountDueMinor };
  return { principalMinor: amountDueMinor - interest, interestMinor: interest, feesMinor: 0, totalMinor: amountDueMinor };
}

export type SplitError = "invalid" | "empty" | "principal_over_outstanding";

/** Checks a split the person edited: whole minor units ≥ 0, more than zero in all, principal ≤ owed. */
export function checkPaymentSplit(
  split: Pick<PaymentSplit, "principalMinor" | "interestMinor" | "feesMinor">,
  outstandingMinor: number,
): SplitError | null {
  const parts = [split.principalMinor, split.interestMinor, split.feesMinor];
  if (parts.some((p) => !Number.isSafeInteger(p) || p < 0 || p > MAX_AMOUNT_MINOR)) return "invalid";
  if (addMinor(...parts) === 0) return "empty";
  if (split.principalMinor > outstandingMinor) return "principal_over_outstanding";
  return null;
}

export function splitTotal(split: Pick<PaymentSplit, "principalMinor" | "interestMinor" | "feesMinor">): number {
  return addMinor(split.principalMinor, split.interestMinor, split.feesMinor);
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface LoanProgress {
  outstandingMinor: number;
  /** Principal repaid since tracking started (principalAtStart − outstanding, never below 0). */
  repaidMinor: number;
  /** repaid / principal at start, basis points (0..10,000). */
  repaidBps: number;
  closed: boolean;
}

/** `principalAtStartMinor`: outstanding when tracking started plus any capitalised interest. */
export function loanProgress(outstandingMinor: number, principalAtStartMinor: number): LoanProgress {
  checkMinor(principalAtStartMinor, "Principal");
  if (!Number.isSafeInteger(outstandingMinor)) throw new RangeError("Outstanding out of range");
  const owed = Math.max(0, outstandingMinor);
  const repaidMinor = Math.max(0, principalAtStartMinor - owed);
  const repaidBps = principalAtStartMinor === 0 ? 10_000 : toSafe(divRoundHalfAway(BigInt(Math.min(repaidMinor, principalAtStartMinor)) * 10_000n, BigInt(principalAtStartMinor)));
  return { outstandingMinor: owed, repaidMinor, repaidBps, closed: owed === 0 };
}

/** Owed on a loan from its liability account balance (0 or negative): −balance, never below 0. */
export function outstandingFromBalance(balanceMinor: number): number {
  if (!Number.isSafeInteger(balanceMinor)) throw new RangeError("Balance out of range");
  return balanceMinor >= 0 ? 0 : -balanceMinor;
}
