// Fixed deposits (Sprint 7): a tracker, INR only, not linked to accounts or Total available.
// All maths is exact (BigInt rationals) and rounded once, half away from zero, to minor units.
//
// Compounding periods are whole calendar months counted from the start date: period k ends
// on start + k × (months per period), clamped to the end of the month (a 31 January start
// has periods ending 30 April, 31 July, … for quarterly). With r = rate in basis points and
// n = periods per year (12, 4, 2 or 1):
//
//   after k whole periods   B_k = P × (1 + r / (10000 × n))^k
//   partial last period     V   = B_k × (1 + r × d / (365 × 10000))
//
// where d is the days from the end of period k to the valuation date (simple interest on
// the compounded balance, always 365 days a year, also in leap years). The value on any date
// is capped at maturity; before the start date it is the principal.
import { daysBetween } from "./dashboard";
import { type IsoDate, daysInMonth, parseIsoDate } from "./dates";
import { ratioToBasisPoints } from "./format";
import { divRoundHalfAway } from "./goals";
import type { PortfolioTotals } from "./investments";
import { MAX_AMOUNT_MINOR, addMinor } from "./money";

export const FD_COMPOUNDING = ["monthly", "quarterly", "half_yearly", "yearly"] as const;
export type FdCompounding = (typeof FD_COMPOUNDING)[number];
export const FD_DEFAULT_COMPOUNDING: FdCompounding = "quarterly";

/** Calendar months per compounding period. */
export const FD_PERIOD_MONTHS: Record<FdCompounding, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

/** 0% to 25% a year, in basis points. */
export const FD_MAX_RATE_BPS = 2_500;
/** Longest tenure accepted: 10 years (Indian banks' usual maximum). */
export const FD_MAX_TENURE_MONTHS = 120;
export const FD_DAYS_PER_YEAR = 365;
/** Bank name and the optional label, in characters after trimming (as the database checks). */
export const FD_BANK_MAX = 80;
export const FD_LABEL_MAX = 40;

export interface FixedDeposit {
  principalMinor: number;
  rateBps: number;
  compounding: FdCompounding;
  startDate: IsoDate;
  maturityDate: IsoDate;
}

export interface FdFigures {
  maturityValueMinor: number;
  /** Maturity value − principal. */
  interestMinor: number;
  /** Value on `today`, capped at maturity (the principal before the start date). */
  accruedValueMinor: number;
  accruedInterestMinor: number;
  /** Days from `today` to maturity; 0 once matured. */
  daysLeft: number;
  matured: boolean;
}

function mustParse(date: IsoDate) {
  const p = parseIsoDate(date);
  if (!p) throw new RangeError(`Not an ISO date: ${date}`);
  return p;
}

/** `date` plus whole calendar months, clamped to the end of the month (31 Jan + 1 → 28/29 Feb). */
export function addMonthsClamped(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = mustParse(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const d = Math.min(day, daysInMonth(y, m));
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function check(fd: FixedDeposit) {
  if (!Number.isSafeInteger(fd.principalMinor) || fd.principalMinor < 1 || fd.principalMinor > MAX_AMOUNT_MINOR) {
    throw new RangeError("Principal out of range");
  }
  if (!Number.isInteger(fd.rateBps) || fd.rateBps < 0 || fd.rateBps > FD_MAX_RATE_BPS) throw new RangeError("Rate out of range");
  if (!(fd.compounding in FD_PERIOD_MONTHS)) throw new RangeError("Unknown compounding");
  mustParse(fd.startDate);
  mustParse(fd.maturityDate);
  if (fd.maturityDate <= fd.startDate) throw new RangeError("Maturity must be after the start date");
  if (fd.maturityDate > addMonthsClamped(fd.startDate, FD_MAX_TENURE_MONTHS)) throw new RangeError("Tenure is too long");
}

function toSafe(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError("Amount is too large to be exact");
  return n;
}

/** Exact value on `date` (capped at maturity) as a rational num / den, in minor units. */
function exactValue(fd: FixedDeposit, date: IsoDate): { num: bigint; den: bigint } {
  const P = BigInt(fd.principalMinor);
  if (date <= fd.startDate) return { num: P, den: 1n };
  const until = date < fd.maturityDate ? date : fd.maturityDate;
  const months = FD_PERIOD_MONTHS[fd.compounding];

  // Whole periods that end on or before `until`; each end is computed from the start date.
  let k = 0;
  while (addMonthsClamped(fd.startDate, (k + 1) * months) <= until) k += 1;
  const lastEnd = addMonthsClamped(fd.startDate, k * months);
  const days = BigInt(daysBetween(lastEnd, until));

  // Per period: 1 + r / (10000 × n) = (10000 × n + r) / (10000 × n), with 10000 × n = 120000 / months.
  const periodDen = 120_000n / BigInt(months);
  const r = BigInt(fd.rateBps);
  const growthNum = (periodDen + r) ** BigInt(k);
  const growthDen = periodDen ** BigInt(k);
  const simpleDen = BigInt(FD_DAYS_PER_YEAR) * 10_000n;
  return { num: P * growthNum * (simpleDen + r * days), den: growthDen * simpleDen };
}

/** Value on `date` in minor units, rounded once (capped at maturity; principal before start). */
export function fdValueOn(fd: FixedDeposit, date: IsoDate): number {
  check(fd);
  mustParse(date);
  const { num, den } = exactValue(fd, date);
  return toSafe(divRoundHalfAway(num, den));
}

export function fdFigures(fd: FixedDeposit, today: IsoDate): FdFigures {
  const maturityValueMinor = fdValueOn(fd, fd.maturityDate);
  const accruedValueMinor = fdValueOn(fd, today);
  const matured = today >= fd.maturityDate;
  return {
    maturityValueMinor,
    interestMinor: maturityValueMinor - fd.principalMinor,
    accruedValueMinor,
    accruedInterestMinor: accruedValueMinor - fd.principalMinor,
    daysLeft: matured ? 0 : daysBetween(today, fd.maturityDate),
    matured,
  };
}

/**
 * Fixed deposits as investment totals (the same shape as the holdings' PortfolioTotals):
 * invested = principal, value = accrued value today, profit = accrued interest. Each deposit
 * is already rounded to paise, so these are plain sums.
 */
export function fdPortfolioTotals(deposits: readonly { principalMinor: number; figures: FdFigures }[]): PortfolioTotals {
  const investedMinor = addMinor(...deposits.map((d) => d.principalMinor));
  const valueMinor = addMinor(...deposits.map((d) => d.figures.accruedValueMinor));
  const profitMinor = valueMinor - investedMinor;
  return {
    investedMinor,
    pricedInvestedMinor: investedMinor,
    valueMinor,
    profitMinor,
    profitBps: ratioToBasisPoints(profitMinor, investedMinor),
    pricedCount: deposits.length,
    unpricedCount: 0,
  };
}

/** Holdings and deposits together: sums of the (already rounded) parts; % from the sums. */
export function addPortfolioTotals(a: PortfolioTotals, b: PortfolioTotals): PortfolioTotals {
  if (b.pricedCount + b.unpricedCount === 0) return a;
  if (a.pricedCount + a.unpricedCount === 0) return b;
  const investedMinor = addMinor(a.investedMinor, b.investedMinor);
  const profitMinor = addMinor(a.profitMinor, b.profitMinor);
  return {
    investedMinor,
    pricedInvestedMinor: addMinor(a.pricedInvestedMinor, b.pricedInvestedMinor),
    valueMinor: addMinor(a.valueMinor, b.valueMinor),
    profitMinor,
    profitBps: ratioToBasisPoints(profitMinor, investedMinor),
    pricedCount: a.pricedCount + b.pricedCount,
    unpricedCount: a.unpricedCount + b.unpricedCount,
  };
}
