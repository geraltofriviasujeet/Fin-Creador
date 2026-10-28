// Money input and arithmetic. Amounts are integer minor units held as JavaScript numbers;
// the database caps every stored amount at 10^13 minor units so sums stay exact (far
// below Number.MAX_SAFE_INTEGER). Every addition is checked anyway.
import { minorUnitsToDecimalString } from "./format";

/** Largest amount accepted for one entry or opening balance (matches the database). */
export const MAX_AMOUNT_MINOR = 10_000_000_000_000;

// ISO 4217 minor-unit digits that differ from 2. Kept as a table (not Intl) so web and
// mobile (Hermes) agree.
const ZERO_DIGIT = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_DIGIT = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function currencyMinorDigits(currency: string): number {
  if (ZERO_DIGIT.has(currency)) return 0;
  if (THREE_DIGIT.has(currency)) return 3;
  return 2;
}

/** Sum of minor-unit amounts; throws instead of silently losing precision. */
export function addMinor(...values: number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new RangeError("Minor-unit amounts must be safe integers");
    total += value;
    if (!Number.isSafeInteger(total)) throw new RangeError("Minor-unit sum is too large to be exact");
  }
  return total;
}

export type AmountError = "empty" | "invalid" | "too_many_decimals" | "negative" | "zero" | "too_large";

export type AmountParseResult = { ok: true; minor: number } | { ok: false; error: AmountError };

export const AMOUNT_ERROR_MESSAGES: Record<AmountError, string> = {
  empty: "Enter an amount",
  invalid: "Enter a number, e.g. 1,28,000.50",
  too_many_decimals: "Too many decimal places for this currency",
  negative: "Amount can't be negative",
  zero: "Amount must be more than zero",
  too_large: "Amount is too large",
};

/**
 * Parses what a person typed ("1,28,000.50", "₹ 2500", "-1500") into integer minor units
 * without floating point. Commas, spaces and one leading ₹ $ € £ ¥ symbol are ignored.
 */
export function parseAmount(
  input: string,
  currency: string,
  { allowNegative = false, allowZero = false }: { allowNegative?: boolean; allowZero?: boolean } = {},
): AmountParseResult {
  const cleaned = input.replace(/[\s,]/g, "").replace(/^[₹$€£¥]/, "");
  if (cleaned === "") return { ok: false, error: "empty" };
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return { ok: false, error: "invalid" };

  const negative = m[1] === "-";
  const whole = m[2] || "0";
  const fraction = m[3] ?? "";
  const digits = currencyMinorDigits(currency);
  if (fraction.length > digits) return { ok: false, error: "too_many_decimals" };

  const magnitude = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0");
  if (magnitude > BigInt(MAX_AMOUNT_MINOR)) return { ok: false, error: "too_large" };
  if (magnitude === 0n) return allowZero ? { ok: true, minor: 0 } : { ok: false, error: "zero" };
  if (negative && !allowNegative) return { ok: false, error: "negative" };
  const minor = Number(magnitude);
  return { ok: true, minor: negative ? -minor : minor };
}

/** Minor units back to an editable string ("128000.5" → "1,28,000.50" is the formatter's job). */
export function minorToInputString(minor: number, currency: string): string {
  const text = minorUnitsToDecimalString(minor, currencyMinorDigits(currency));
  return text.replace(/\.0+$/, "");
}

/**
 * Groups the whole part of a plain number string: Indian style for en-IN (12,34,567), else
 * thousands (1,234,567). String work only, so web and mobile (Hermes) agree.
 */
function groupWhole(whole: string, locale: string): string {
  if (whole.length <= 3) return whole;
  const last = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const size = locale === "en-IN" ? 2 : 3;
  const groups: string[] = [];
  for (let end = rest.length; end > 0; end -= size) groups.unshift(rest.slice(Math.max(0, end - size), end));
  return `${groups.join(",")},${last}`;
}

/** Like minorToInputString, with digit grouping for display in an input: 2665464 → "26,654.64". */
export function minorToGroupedInputString(minor: number, currency: string, locale = "en-IN"): string {
  const text = minorToInputString(minor, currency);
  const negative = text.startsWith("-");
  const [whole = "0", fraction] = (negative ? text.slice(1) : text).split(".");
  return `${negative ? "-" : ""}${groupWhole(whole, locale)}${fraction === undefined ? "" : `.${fraction}`}`;
}

/** What a person typed, re-grouped when it is a valid amount (on blur); otherwise unchanged. */
export function regroupAmountInput(input: string, currency: string, locale = "en-IN"): string {
  const parsed = parseAmount(input, currency, { allowZero: true });
  if (!parsed.ok) return input;
  return minorToGroupedInputString(parsed.minor, currency, locale);
}
