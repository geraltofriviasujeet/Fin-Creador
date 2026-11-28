import { type ActivityFilters, type MonthChip, type TransactionTotals, monthLabel } from "@fin-creador/api";
import { type IsoDate, displayedNetWhole, formatMoney, formatMoneyWhole, monthRange, savingsRateBasisPoints, savingsRatePointsChange } from "@fin-creador/domain";

// Text for the phone's Activity tab (Sprint 13b PR 4). Pure and Hermes-safe: money through
// packages/domain, percentages in integer maths (no Intl), dates from packages/api.

/** Whole percent from basis points, rounded half away from zero: 5,211 → "52%". */
export function wholePercent(basisPoints: number): string {
  const n = Math.round(Math.abs(basisPoints) / 100);
  return `${basisPoints < 0 && n !== 0 ? "−" : ""}${n}%`;
}

export type SummaryText = {
  moneyIn: string;
  moneyOut: string;
  /** "Net +₹72,600" or "Net −₹3,000"; whole rupees, the shown in minus the shown out, so the three add up. */
  net: string;
  netTone: "moneyIn" | "warning" | "ink";
  /** "85% saved", "Spent ₹3,000 more than came in", or "No money in yet". */
  rate: string;
  /** "+4 pts vs Oct", or null when there is nothing to compare. */
  trend: string | null;
};

/**
 * The Money in / Money out tiles and the line under them. Money out is net of refunds (as on the
 * web); transfers are neither. `previous` is the month before, for the savings-rate trend.
 */
export function summaryText(totals: TransactionTotals, currency: string, previous: { totals: TransactionTotals; month: IsoDate } | null): SummaryText {
  const netWhole = Number(displayedNetWhole(totals.incomeMinor, totals.expenseMinor, currency));
  const netBody = formatMoney(Math.abs(netWhole), { currency });
  const net = netWhole === 0 ? `Net ${netBody}` : `Net ${netWhole > 0 ? "+" : "−"}${netBody}`;
  const rateBp = savingsRateBasisPoints(totals);
  const rate =
    rateBp === null
      ? "No money in yet"
      : totals.netMinor < 0
        ? `Spent ${formatMoneyWhole(-totals.netMinor, { currency })} more than came in`
        : `${wholePercent(rateBp)} saved`;
  const change = previous ? savingsRatePointsChange(totals, previous.totals) : null;
  const pts = change === null ? 0 : Math.round(change / 100);
  const trend = change === null ? null : `${pts > 0 ? "+" : pts < 0 ? "−" : ""}${Math.abs(pts)} pts vs ${monthLabel(previous!.month)}`;
  return {
    moneyIn: formatMoneyWhole(totals.incomeMinor, { currency }),
    moneyOut: formatMoneyWhole(totals.expenseMinor, { currency }),
    net,
    netTone: netWhole > 0 ? "moneyIn" : netWhole < 0 ? "warning" : "ink",
    rate,
    trend,
  };
}

/** A day's total beside its heading: "+₹85,000 · −₹1,200" (exact, like the rows); "₹0" when nothing moved in or out; "" while the day may continue on the next page. */
export function dayTotalText(totals: { inMinor: number; outMinor: number } | null, currency: string): string {
  if (!totals) return "";
  const parts: string[] = [];
  if (totals.inMinor > 0) parts.push(`+${formatMoney(totals.inMinor, { currency })}`);
  if (totals.outMinor > 0) parts.push(`−${formatMoney(totals.outMinor, { currency })}`);
  // Refunds above the day's spending: money came back.
  if (totals.outMinor < 0) parts.push(`+${formatMoney(-totals.outMinor, { currency })} back`);
  // A whole day of transfers or voided entries still has a total: nothing came in or went out.
  return parts.length > 0 ? parts.join(" · ") : formatMoney(0, { currency });
}

/** The same in words for a screen reader: "Money in ₹85,000, money out ₹1,200". */
export function dayTotalLabel(totals: { inMinor: number; outMinor: number } | null, currency: string): string {
  if (!totals) return "";
  const parts: string[] = [];
  if (totals.inMinor > 0) parts.push(`money in ${formatMoney(totals.inMinor, { currency })}`);
  if (totals.outMinor > 0) parts.push(`money out ${formatMoney(totals.outMinor, { currency })}`);
  if (totals.outMinor < 0) parts.push(`refunded ${formatMoney(-totals.outMinor, { currency })}`);
  const text = parts.join(", ");
  return text ? text[0]!.toUpperCase() + text.slice(1) : "No money in or out";
}

/** The month chips, plus the picked month at the end when it is older than the chips show. */
export function visibleMonthChips(chips: readonly MonthChip[], f: Pick<ActivityFilters, "month">): MonthChip[] {
  if (f.month === null || chips.some((c) => c.month === f.month)) return [...chips];
  return [...chips, { month: f.month, label: monthLabel(f.month) }];
}

export type PickerMonth = { month: IsoDate; label: string; disabled: boolean };

/** The month picker's 12 months for a year; months after this one can't be picked. */
export function pickerMonths(year: number, today: IsoDate): PickerMonth[] {
  const thisMonth = monthRange(today).start;
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}-01`;
    return { month, label: monthLabel(month, month), disabled: month > thisMonth };
  });
}

/** Earliest year the picker offers: far enough back for any history kept. */
export const PICKER_FIRST_YEAR = 2000;
