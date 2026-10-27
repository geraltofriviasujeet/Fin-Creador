// Investments (Sprint 7): a holdings tracker, not a ledger. A record is an instrument, units,
// a buy price per unit and a buy date; several records per instrument are allowed.
//
// Units and prices are scaled integers with 4 decimals (12.3456 units = 123456). Amounts are
// computed exactly with BigInt in 10^-8 rupees (units × price) and rounded once, half away
// from zero, to minor units (paise), the same rule as divRoundHalfAway. INR only.
//
//   invested = units × buy price
//   value    = units × latest price
//   profit   = value − invested            (rounded once from the exact difference)
//   profit % = profit / invested in basis points (null when invested is 0)
//
// Totals (per instrument and for the portfolio) sum the exact amounts and round once, so a
// total can differ by a few paise from the sum of the rounded rows. A latest price that is
// missing or 0 means "no price": the record keeps its invested amount but gets no value or
// profit and stays out of value and profit totals. Valuation happens here only, not in SQL.
import { addDays, type IsoDate } from "./dates";
import { DEFAULT_LOCALE, minorUnitsToDecimalString } from "./format";
import { divRoundHalfAway } from "./goals";
import { PRICE_SCALE } from "./market-files";
import { MAX_AMOUNT_MINOR } from "./money";

export const UNIT_SCALE = 4;

/** Largest stored units (10^9 units) and price per unit (₹10^9); matches the database. */
export const MAX_UNITS_SCALED = 10_000_000_000_000;
export const MAX_PRICE_SCALED = 10_000_000_000_000;
/** The price shown gets an "Old price" badge once it is more than this many days old. */
export const OLD_PRICE_AFTER_DAYS = 7;
/** Instruments are offered in search while their price is at most this many days old. */
export const SEARCHABLE_PRICE_DAYS = 30;

const INR_MINOR_DIGITS = 2;
/** Exact amount (10^-8 rupees) per minor unit. */
const AMOUNT_DIVISOR = 10n ** BigInt(UNIT_SCALE + PRICE_SCALE - INR_MINOR_DIGITS);

export interface HoldingRecord {
  instrumentId: string;
  unitsScaled: number;
  buyPriceScaled: number;
}

export interface HoldingFigures {
  investedMinor: number;
  /** Null when the instrument has no price. */
  valueMinor: number | null;
  profitMinor: number | null;
  /** Profit as a share of invested, in basis points; null without a price or when invested is 0. */
  profitBps: number | null;
}

function checkScaled(value: number, name: string, { min, max }: { min: number; max: number }): bigint {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return BigInt(value);
}

function toSafe(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError("Amount is too large to be exact");
  return n;
}

/** A usable latest price as BigInt, or null for missing / 0. */
function latestPrice(priceScaled: number | null): bigint | null {
  if (priceScaled === null || priceScaled === 0) return null;
  return checkScaled(priceScaled, "Latest price", { min: 1, max: MAX_PRICE_SCALED });
}

interface Exact {
  invested: bigint;
  value: bigint | null;
}

function exactRecord(record: HoldingRecord, price: bigint | null): Exact {
  const units = checkScaled(record.unitsScaled, "Units", { min: 1, max: MAX_UNITS_SCALED });
  const buy = checkScaled(record.buyPriceScaled, "Buy price", { min: 0, max: MAX_PRICE_SCALED });
  return { invested: units * buy, value: price === null ? null : units * price };
}

function figuresFromExact(invested: bigint, value: bigint | null): HoldingFigures {
  const investedMinor = toSafe(divRoundHalfAway(invested, AMOUNT_DIVISOR));
  if (value === null) return { investedMinor, valueMinor: null, profitMinor: null, profitBps: null };
  const profit = value - invested;
  return {
    investedMinor,
    valueMinor: toSafe(divRoundHalfAway(value, AMOUNT_DIVISOR)),
    profitMinor: toSafe(divRoundHalfAway(profit, AMOUNT_DIVISOR)),
    profitBps: invested === 0n ? null : toSafe(divRoundHalfAway(profit * 10_000n, invested)),
  };
}

/** Invested, value and profit of one record at the instrument's latest price. */
export function holdingFigures(record: HoldingRecord, latestPriceScaled: number | null): HoldingFigures {
  const exact = exactRecord(record, latestPrice(latestPriceScaled));
  return figuresFromExact(exact.invested, exact.value);
}

export interface InstrumentGroup<R extends HoldingRecord = HoldingRecord> {
  instrumentId: string;
  records: R[];
  totalUnitsScaled: number;
  /** Σ(units × buy price) / Σ units at 4 decimals, rounded half away from zero. */
  averageBuyPriceScaled: number;
  figures: HoldingFigures;
}

/** Groups records by instrument (first-seen order) with exact totals rounded once. */
export function groupHoldings<R extends HoldingRecord>(
  records: readonly R[],
  priceOf: (instrumentId: string) => number | null,
): InstrumentGroup<R>[] {
  const groups = new Map<string, { records: R[]; units: bigint; invested: bigint; value: bigint | null }>();
  for (const record of records) {
    const price = latestPrice(priceOf(record.instrumentId));
    const exact = exactRecord(record, price);
    const group = groups.get(record.instrumentId) ?? { records: [], units: 0n, invested: 0n, value: price === null ? null : 0n };
    group.records.push(record);
    group.units += BigInt(record.unitsScaled);
    group.invested += exact.invested;
    group.value = group.value === null || exact.value === null ? null : group.value + exact.value;
    groups.set(record.instrumentId, group);
  }
  return [...groups].map(([instrumentId, g]) => ({
    instrumentId,
    records: g.records,
    totalUnitsScaled: toSafe(g.units),
    averageBuyPriceScaled: toSafe(divRoundHalfAway(g.invested, g.units)),
    figures: figuresFromExact(g.invested, g.value),
  }));
}

export interface PortfolioTotals {
  /** All records, priced or not. */
  investedMinor: number;
  /** Records with a price only: their invested, value and profit. */
  pricedInvestedMinor: number;
  valueMinor: number;
  profitMinor: number;
  profitBps: number | null;
  pricedCount: number;
  unpricedCount: number;
}

export function portfolioTotals(
  records: readonly HoldingRecord[],
  priceOf: (instrumentId: string) => number | null,
): PortfolioTotals {
  let invested = 0n;
  let pricedInvested = 0n;
  let value = 0n;
  let pricedCount = 0;
  for (const record of records) {
    const exact = exactRecord(record, latestPrice(priceOf(record.instrumentId)));
    invested += exact.invested;
    if (exact.value === null) continue;
    pricedCount += 1;
    pricedInvested += exact.invested;
    value += exact.value;
  }
  const priced = figuresFromExact(pricedInvested, value);
  return {
    investedMinor: toSafe(divRoundHalfAway(invested, AMOUNT_DIVISOR)),
    pricedInvestedMinor: priced.investedMinor,
    valueMinor: priced.valueMinor ?? 0,
    profitMinor: priced.profitMinor ?? 0,
    profitBps: priced.profitBps,
    pricedCount,
    unpricedCount: records.length - pricedCount,
  };
}

/** True once the price is more than OLD_PRICE_AFTER_DAYS days older than `today`. */
export function isOldPrice(priceDate: IsoDate, today: IsoDate): boolean {
  return addDays(priceDate, OLD_PRICE_AFTER_DAYS) < today;
}

/** The instrument's ISIN differs from the one saved with the record (skipped if either is null). */
export function identifierChanged(isinAtEntry: string | null, currentIsin: string | null): boolean {
  return isinAtEntry !== null && currentIsin !== null && isinAtEntry !== currentIsin;
}

// ---------------------------------------------------------------------------
// Input: units and prices typed by a person (no rounding: more than 4 decimals is an error)
// ---------------------------------------------------------------------------

export type ScaledInputError = "empty" | "invalid" | "too_many_decimals" | "zero" | "too_large";

export type ScaledInputResult = { ok: true; scaled: number } | { ok: false; error: ScaledInputError };

/** Units or a price per unit (both 4 decimals): "1,234.5678" -> 12345678. Commas, spaces and one leading ₹ are ignored; never negative. */
export function parseScaledInput(
  input: string,
  { max, allowZero = false }: { max: number; allowZero?: boolean },
): ScaledInputResult {
  const cleaned = input.replace(/[\s,]/g, "").replace(/^₹/, "");
  if (cleaned === "") return { ok: false, error: "empty" };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m || ((m[1] ?? "") === "" && (m[2] ?? "") === "")) return { ok: false, error: "invalid" };
  const fraction = m[2] ?? "";
  if (fraction.length > UNIT_SCALE) return { ok: false, error: "too_many_decimals" };
  const scaled = BigInt(m[1] || "0") * 10n ** BigInt(UNIT_SCALE) + BigInt(fraction.padEnd(UNIT_SCALE, "0"));
  if (scaled > BigInt(max)) return { ok: false, error: "too_large" };
  if (scaled === 0n && !allowZero) return { ok: false, error: "zero" };
  return { ok: true, scaled: Number(scaled) };
}

/** Exact invested amount in minor units, or null if it is over MAX_AMOUNT_MINOR. */
export function investedMinorWithinLimit(unitsScaled: number, buyPriceScaled: number): number | null {
  const exact = BigInt(unitsScaled) * BigInt(buyPriceScaled);
  if (exact > BigInt(MAX_AMOUNT_MINOR) * AMOUNT_DIVISOR) return null;
  return toSafe(divRoundHalfAway(exact, AMOUNT_DIVISOR));
}

/**
 * The price that counts for value and profit: the latest price unless it is more than
 * SEARCHABLE_PRICE_DAYS days old (the instrument has left the daily files, e.g. suspended or
 * delisted). An older price is still shown with its date, but the record counts as unpriced.
 */
export function currentPriceScaled(priceScaled: number, priceDate: IsoDate, today: IsoDate): number | null {
  return addDays(priceDate, SEARCHABLE_PRICE_DAYS) < today ? null : priceScaled;
}

// ---------------------------------------------------------------------------
// Display: scaled values as exact decimal strings, formatted by Intl (no floats)
// ---------------------------------------------------------------------------

/** 125000 → "12.5"; keeps at least `minDecimals` places (exact, from the integer). */
export function scaledToDecimalString(scaled: number, minDecimals = 0): string {
  const text = minorUnitsToDecimalString(scaled, UNIT_SCALE);
  const [whole, fraction = ""] = text.split(".");
  const kept = fraction.replace(/0+$/, "").padEnd(minDecimals, "0");
  return kept ? `${whole}.${kept}` : (whole ?? "0");
}

/** Units for display: 1234.5 units → "1,234.5" (up to 4 decimals, Indian grouping by default). */
export function formatUnits(unitsScaled: number, locale = DEFAULT_LOCALE): string {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: UNIT_SCALE });
  return formatter.format(scaledToDecimalString(unitsScaled) as unknown as number);
}

/** A price per unit in rupees: 12505000 → "₹1,250.50", 287924 → "₹28.7924" (2 to 4 decimals). */
export function formatPriceScaled(priceScaled: number, locale = DEFAULT_LOCALE): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: PRICE_SCALE,
  });
  return formatter.format(scaledToDecimalString(priceScaled, 2) as unknown as number);
}

/** A scaled value back into a form field: 12505000 → "1250.5". */
export const scaledToInputString = (scaled: number): string => scaledToDecimalString(scaled);
