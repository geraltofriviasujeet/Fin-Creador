// Display formatting shared by web and mobile. Money is held as integer minor units
// (e.g. paise) and converted to an exact decimal string before formatting, so no
// binary floating point is involved.

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

function currencyDigits(currency: string, locale: string): number {
  return (
    new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
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
  const digits = currencyDigits(currency, locale);
  const decimal = minorUnitsToDecimalString(amount, digits);
  const isWhole = digits === 0 || /\.0+$/.test(decimal);
  const shownDigits = trimZeroFraction && isWhole ? 0 : digits;

  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: shownDigits,
    maximumFractionDigits: shownDigits,
    signDisplay: signed ? "exceptZero" : "auto",
  });
  // Intl accepts decimal strings (exact); the cast covers lib typings that lag behind.
  return formatter.format(decimal as unknown as number);
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
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(basisPoints / 10_000);
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
