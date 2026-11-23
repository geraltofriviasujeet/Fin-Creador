// Currency facts kept as tables and string work, not Intl, so web and mobile agree. Hermes
// (React Native) ships a partial Intl: on iOS Intl.NumberFormat has no formatToParts, and
// DateTimeFormat.formatToParts returns one literal part. Nothing here may depend on those.

// ISO 4217 minor-unit digits that differ from 2.
const ZERO_DIGIT = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_DIGIT = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function currencyMinorDigits(currency: string): number {
  if (ZERO_DIGIT.has(currency)) return 0;
  if (THREE_DIGIT.has(currency)) return 3;
  return 2;
}

/** Symbols for the currencies people pick most; others come from Intl when it can say. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
};

/**
 * The symbol drawn before an amount (INR → "₹"). Uses the table first, then
 * Intl.NumberFormat#formatToParts only when the engine has it, else the ISO code. Never throws.
 */
export function currencySymbol(currency: string, locale = "en-IN"): string {
  const known = CURRENCY_SYMBOLS[currency];
  if (known) return known;
  try {
    const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
    if (typeof formatter.formatToParts === "function") {
      const part = formatter.formatToParts(0).find((p) => p.type === "currency");
      if (part?.value) return part.value;
    }
  } catch {
    // Unknown currency or no Intl: fall through to the code.
  }
  return currency;
}

/**
 * Groups the whole part of a plain number string: Indian style for en-IN (12,34,567), else
 * thousands (1,234,567).
 */
export function groupWholeDigits(whole: string, locale: string): string {
  if (whole.length <= 3) return whole;
  const last = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const size = locale === "en-IN" ? 2 : 3;
  const groups: string[] = [];
  for (let end = rest.length; end > 0; end -= size) groups.unshift(rest.slice(Math.max(0, end - size), end));
  return `${groups.join(",")},${last}`;
}
