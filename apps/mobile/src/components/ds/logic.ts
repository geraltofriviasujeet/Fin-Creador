// Pure helpers behind the design-system components (no React Native imports), so they are
// unit-tested with Vitest. Money formatting comes from @fin-creador/domain only.
import {
  DEFAULT_LOCALE,
  currencyMinorDigits,
  currencySymbol,
  formatMoney,
  formatMoneyWhole,
  parseAmount,
  regroupAmountInput,
} from "@fin-creador/domain";
import { mobile, spacing } from "@fin-creador/design-tokens";

/** in = money received (+, green), out = money spent (−), neutral = a balance or total. */
export type Direction = "in" | "out" | "neutral";

/** U+2212 MINUS SIGN: the typographic minus, same width as +. */
export const MINUS = "−";

export type AmountDisplay = {
  /** What is drawn, e.g. "−₹1,250" or "+₹42,000". */
  text: string;
  /** What a screen reader says, e.g. "Money out, ₹1,250". Never relies on the colour. */
  label: string;
  /** Token colour name for the text. */
  tone: "ink" | "moneyIn" | "warning";
};

/**
 * Formats a signed amount for display. `minor` is in minor units (paise). Money out shows a
 * minus, money in a plus and green; a negative neutral figure (an overdrawn balance) shows a
 * minus in warning colour. `whole` (default) rounds to whole rupees for summaries.
 */
export function formatAmount(
  minor: number,
  {
    direction = "neutral",
    currency = "INR",
    locale = DEFAULT_LOCALE,
    whole = true,
  }: { direction?: Direction; currency?: string; locale?: string; whole?: boolean } = {},
): AmountDisplay {
  const magnitude = Math.abs(minor);
  const format = whole ? formatMoneyWhole : formatMoney;
  const body = format(magnitude, { currency, locale });

  if (direction === "in") return { text: `+${body}`, label: `Money in, ${body}`, tone: "moneyIn" };
  if (direction === "out") return { text: `${MINUS}${body}`, label: `Money out, ${body}`, tone: "ink" };
  if (minor < 0) return { text: `${MINUS}${body}`, label: `Minus ${body}`, tone: "warning" };
  return { text: body, label: body, tone: "ink" };
}

/**
 * hitSlop that grows a control of the given visual size to the 44×44 minimum tap target.
 * Returns undefined when the control is already large enough.
 */
export function hitSlopFor(
  height: number,
  width: number = height,
  min: number = mobile.tapTarget,
): { top: number; bottom: number; left: number; right: number } | undefined {
  const v = Math.max(0, Math.ceil((min - height) / 2));
  const h = Math.max(0, Math.ceil((min - width) / 2));
  if (v === 0 && h === 0) return undefined;
  return { top: v, bottom: v, left: h, right: h };
}

/** Effective tap size (visual size plus hitSlop) on one axis. */
export function tapSize(size: number, slop: number | undefined): number {
  return size + 2 * (slop ?? 0);
}

/** How far the tab bar's raised ＋ rises above the bar's top edge into the screen above. */
export const RAISED_ADD_OVERLAP = mobile.tabBar.raisedButton / 2 + spacing[1];

/** Space left between a tab screen's last row and the top of the raised ＋. */
export const TAB_SCREEN_CLEARANCE = 24;

/**
 * Bottom padding for a scrolling tab screen (Home, Activity, Plan, Roma): just clear of the
 * raised ＋ plus 24px (owner, PR #94 review). The tab bar sits below the screen (not over it)
 * and pads itself for the safe area, so only the ＋'s overlap needs clearing.
 */
export const TAB_SCREEN_BOTTOM_PADDING = RAISED_ADD_OVERLAP + TAB_SCREEN_CLEARANCE;

// ---- Number keypad -------------------------------------------------------------------

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

export const KEYPAD_ROWS: readonly (readonly KeypadKey[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "back"],
];

export function keypadKeyLabel(key: KeypadKey): string {
  if (key === "back") return "Delete last digit";
  if (key === ".") return "Decimal point";
  return key;
}

/** Most whole digits a keypad amount may have (₹99,99,99,99,999 is far above any entry). */
const MAX_WHOLE_DIGITS = 11;

/**
 * Applies one keypad press to the typed amount (plain digits, optional "." and decimals).
 * Ignores presses that would make the amount invalid: a second point, more decimals than
 * the currency has, too many digits, or a leading zero before another digit.
 */
export function applyKeypadKey(current: string, key: KeypadKey, currency = "INR"): string {
  if (key === "back") return current.slice(0, -1);
  const digits = currencyMinorDigits(currency);
  const [whole = "", fraction] = current.split(".");
  if (key === ".") {
    if (digits === 0 || fraction !== undefined) return current;
    return `${whole || "0"}.`;
  }
  if (fraction !== undefined) {
    return fraction.length >= digits ? current : `${current}${key}`;
  }
  if (whole === "0") return key; // replace a lone leading zero
  if (whole.length >= MAX_WHOLE_DIGITS) return current;
  return `${current}${key}`;
}

export type AmountInputState = {
  /** Shown text with Indian grouping, e.g. "₹1,250.5". Empty input shows "₹0". */
  display: string;
  /** Minor units when the typed text is a valid positive amount. */
  minor: number | null;
  /** Screen-reader label. */
  label: string;
};

/** Display and parsed value for the large amount shown above the keypad. */
export function amountInputState(typed: string, currency = "INR", locale = DEFAULT_LOCALE): AmountInputState {
  const symbol = currencySymbol(currency, locale);
  const parsed = parseAmount(typed, currency);
  if (typed === "") return { display: `${symbol}0`, minor: null, label: "Amount, empty" };
  // Keep a trailing "." or trailing zeros while typing ("1,250." / "1,250.50").
  const [whole = "0", fraction] = typed.split(".");
  const groupedWhole = regroupAmountInput(whole, currency, locale);
  const display = `${symbol}${groupedWhole}${fraction === undefined ? "" : `.${fraction}`}`;
  return { display, minor: parsed.ok ? parsed.minor : null, label: `Amount, ${display}` };
}

/** INR → "₹". From packages/domain: a table first, never Intl formatToParts (Hermes lacks it). */
export { currencySymbol };

// ---- Progress ------------------------------------------------------------------------

/** Budget bars turn warning colour above this share (design-spec §5: over 90%). */
export const WARN_AT = 0.9;

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Progress (display only) from two integer minor-unit amounts. */
export function progressOf(usedMinor: number, totalMinor: number): number {
  if (totalMinor <= 0) return usedMinor > 0 ? 1 : 0;
  return usedMinor / totalMinor;
}

export function progressA11y(
  value: number,
  warnAt: number | null = WARN_AT,
): { min: number; max: number; now: number; text: string } {
  const now = Math.round(clampProgress(value) * 100);
  const raw = Math.round((Number.isFinite(value) ? Math.max(0, value) : 0) * 100);
  const over = warnAt !== null && value > warnAt;
  const text = raw > 100 ? `${raw} percent, over the limit` : over ? `${now} percent, almost used up` : `${now} percent`;
  return { min: 0, max: 100, now, text };
}

export function isWarning(value: number, warnAt: number | null = WARN_AT): boolean {
  return warnAt !== null && value > warnAt;
}

// ---- Accessibility labels ------------------------------------------------------------

/** One spoken label for a list row: title, subtitle, tag, then the amount. */
export function listRowLabel(parts: {
  title: string;
  subtitle?: string;
  tag?: string;
  amountLabel?: string;
}): string {
  return [parts.title, parts.subtitle, parts.tag, parts.amountLabel].filter(Boolean).join(", ");
}

/** "SBI, ₹12,400 now, ₹11,150 after this" (plus the shortfall when the balance goes below zero). */
export function balanceChangeLabel(
  account: string,
  beforeMinor: number,
  afterMinor: number,
  currency = "INR",
): { before: AmountDisplay; after: AmountDisplay; short: string | null; label: string } {
  const before = formatAmount(beforeMinor, { currency });
  const after = formatAmount(afterMinor, { currency });
  const short = afterMinor < 0 ? `Leaves you ${formatAmount(-afterMinor, { currency }).text} short` : null;
  const label = [`${account}, ${before.label} now, ${after.label} after this`, short].filter(Boolean).join(". ");
  return { before, after, short, label };
}
