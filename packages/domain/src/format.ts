// Display formatting shared by web and mobile. Money is held as integer minor units
// (e.g. paise) and converted to an exact decimal string before formatting, so no
// binary floating point is involved.

import { currencyMinorDigits, currencySymbol, groupWholeDigits } from "./currency";

export type MinorUnits = bigint | number;

export interface MoneyFormatOptions {
  currency: string;
  /** BCP 47 locale. Defaults to en-IN (Indian digit grouping). */
  locale?: string;
  /** Show "+" for positive amounts as well as "−" for negative ones. */
  signed?: boolean;
  /** Drop the fractional part when it is zero (₹4,82,650 instead of ₹4,82,650.00). */
  trimZeroFraction?: boolean;
}

export const DEFAULT_LOCALE = "en-IN";

// From the ISO 4217 table, not Intl resolvedOptions, so every engine agrees.
function currencyDigits(currency: string): number {
  return currencyMinorDigits(currency);
}

/** Exact decimal string for an integer amount of minor units, e.g. 12345n, 2 → "123.45". */
export function minorUnitsToDecimalString(amount: MinorUnits, digits: number): string {
  if (typeof amount === "number" && !Number.isSafeInteger(amount)) {
    throw new RangeError("Minor-unit amounts must be safe integers");
  }
  const value = BigInt(amount);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(digits);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(digits, "0");
  return `${negative ? "-" : ""}${whole}${digits > 0 ? `.${fraction}` : ""}`;
}

export function formatMoney(amount: MinorUnits, options: MoneyFormatOptions): string {
  const { currency, locale = DEFAULT_LOCALE, signed = false, trimZeroFraction = true } = options;
  const digits = currencyDigits(currency);
  const decimal = minorUnitsToDecimalString(amount, digits);
  const negative = decimal.startsWith("-");
  const magnitude = negative ? decimal.slice(1) : decimal;
  const isWhole = digits === 0 || /\.0+$/.test(magnitude);
  const shownDigits = trimZeroFraction && isWhole ? 0 : digits;
  const isZero = !/[1-9]/.test(magnitude);
  // The sign is added here rather than by Intl signDisplay, which older Hermes lacks.
  const sign = isZero ? "" : negative ? "-" : signed ? "+" : "";
  return `${sign}${formatMagnitude(magnitude, shownDigits, currency, locale)}`;
}

/**
 * A non-negative exact decimal string as currency. Intl first; the string formatter when the
 * engine cannot format it or does not group en-IN in lakhs (12,34,567), or loses digits on
 * an amount beyond 2^53. A RangeError (unknown currency or locale) still throws.
 */
function formatMagnitude(magnitude: string, shownDigits: number, currency: string, locale: string): string {
  const [whole = "0", fraction = ""] = magnitude.split(".");
  const grouped = groupWholeDigits(whole, locale);
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: shownDigits,
      maximumFractionDigits: shownDigits,
    });
    // Intl accepts decimal strings (exact); the cast covers lib typings that lag behind.
    const text = formatter.format(magnitude as unknown as number);
    if (locale !== DEFAULT_LOCALE || text.includes(grouped)) return text;
  } catch (error) {
    if (error instanceof RangeError) throw error;
  }
  return `${currencySymbol(currency, locale)}${grouped}${shownDigits > 0 ? `.${fraction.slice(0, shownDigits)}` : ""}`;
}

/**
 * Whole units of the currency (₹1,33,390 for 1,33,389.50): rounded half away from zero, in
 * integer maths, then formatted like formatMoney. For summary figures such as chart labels and
 * income totals; balances keep their exact paise.
 */
// `_locale` stays for callers; the digits depend on the currency only.
export function roundMinorToWhole(amount: MinorUnits, currency: string, _locale = DEFAULT_LOCALE): bigint {
  if (typeof amount === "number" && !Number.isSafeInteger(amount)) {
    throw new RangeError("Minor-unit amounts must be safe integers");
  }
  const scale = 10n ** BigInt(currencyDigits(currency));
  const value = BigInt(amount);
  const abs = value < 0n ? -value : value;
  let whole = abs / scale;
  if ((abs % scale) * 2n >= scale) whole += 1n;
  return (value < 0n ? -whole : whole) * scale;
}

/**
 * Net cash flow as shown beside whole-unit Income and Spent figures: the rounded income minus
 * the rounded spending (in minor units), so the three figures on screen always add up. Display
 * only: the exact net (income − spending) stays the figure everywhere else (Reports, exports).
 */
export function displayedNetWhole(incomeMinor: MinorUnits, expenseMinor: MinorUnits, currency: string, locale = DEFAULT_LOCALE): bigint {
  return roundMinorToWhole(incomeMinor, currency, locale) - roundMinorToWhole(expenseMinor, currency, locale);
}

export function formatMoneyWhole(amount: MinorUnits, options: MoneyFormatOptions): string {
  const rounded = roundMinorToWhole(amount, options.currency, options.locale);
  return formatMoney(rounded, { ...options, trimZeroFraction: true });
}

/**
 * Formats a ratio given in basis points (1% = 100 bp), e.g. 840 → "+8.4%".
 * Basis points keep percentages as integers in data; division here is display-only.
 */
export function formatPercentFromBasisPoints(
  basisPoints: number,
  options: { locale?: string; signed?: boolean; maximumFractionDigits?: number } = {},
): string {
  const { locale = DEFAULT_LOCALE, signed = false, maximumFractionDigits = 1 } = options;
  const magnitude = Math.abs(basisPoints) / 10_000;
  let body: string;
  try {
    body = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits }).format(magnitude);
  } catch {
    body = `${Number((magnitude * 100).toFixed(maximumFractionDigits))}%`;
  }
  // Sign added here (not signDisplay); a figure that rounds to 0% gets none.
  const sign = !/[1-9]/.test(body) ? "" : basisPoints < 0 ? "-" : signed ? "+" : "";
  return `${sign}${body}`;
}

/**
 * part / whole as integer basis points, rounded half away from zero, using integer
 * arithmetic only. Returns null when whole is zero (no meaningful ratio).
 */
export function ratioToBasisPoints(part: MinorUnits, whole: MinorUnits): number | null {
  const p = BigInt(part);
  const w = BigInt(whole);
  if (w === 0n) return null;
  const scaled = p * 10_000n * 2n;
  const quotient = scaled / w;
  const rounded = (quotient + (quotient >= 0n ? 1n : -1n)) / 2n;
  return Number(rounded);
}
