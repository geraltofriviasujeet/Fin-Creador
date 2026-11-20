// Period income (CLAUDE.md §5: income in a period is not an account balance).
// Voided entries never count. Sums include only entries in the profile currency.
import { type DateRange, type IsoDate, isInRange } from "./dates";
import { ratioToBasisPoints } from "./format";
import { addMinor } from "./money";
import type { Frequency } from "./recurrence";

export type SourceType = "salary" | "rent" | "freelance" | "business" | "interest" | "other";

export interface IncomeEntry {
  id: string;
  amountMinor: number;
  currency: string;
  occurredOn: IsoDate;
  sourceId: string;
  accountId: string;
  voided: boolean;
}

export interface IncomeSource {
  id: string;
  name: string;
  sourceType: SourceType;
  defaultAccountId: string | null;
  /** Created automatically; listed only once it has income this year. */
  isDefault: boolean;
  archived: boolean;
}

export interface IncomePeriods {
  month: DateRange;
  previousMonth: DateRange;
  year: DateRange;
}

export function sumIncome(entries: readonly IncomeEntry[], range: DateRange, currency: string): number {
  return addMinor(
    ...entries
      .filter((e) => !e.voided && e.currency === currency && isInRange(e.occurredOn, range))
      .map((e) => e.amountMinor),
  );
}

/** Change from last month in basis points, or null when last month had no income. */
export function incomeTrendBasisPoints(thisMonthMinor: number, lastMonthMinor: number): number | null {
  if (lastMonthMinor === 0) return null;
  return ratioToBasisPoints(addMinor(thisMonthMinor, -lastMonthMinor), lastMonthMinor);
}

export type LinkedAccount =
  | { kind: "account"; accountId: string }
  | { kind: "multiple" }
  | { kind: "none" };

export interface SourceRow<S extends IncomeSource = IncomeSource> {
  source: S;
  monthMinor: number;
  yearMinor: number;
  /** The account that received this source's income this year, else its default account. */
  linked: LinkedAccount;
  /** Every entry this year is voided: listed (so the history stays reachable), counts as 0. */
  onlyVoided: boolean;
}

/**
 * Rows for the Income sources panel: sources with any entry this year (voided ones too,
 * so their history stays reachable), plus sources the user added (not archived). Amounts
 * never include voided entries. Sorted by this year's income, largest first, then name.
 */
export function incomeBySource<S extends IncomeSource>(
  entries: readonly IncomeEntry[],
  sources: readonly S[],
  periods: Pick<IncomePeriods, "month" | "year">,
  currency: string,
): SourceRow<S>[] {
  const rows: SourceRow<S>[] = [];
  for (const source of sources) {
    const allThisYear = entries.filter((e) => e.sourceId === source.id && isInRange(e.occurredOn, periods.year));
    const thisYear = allThisYear.filter((e) => !e.voided);
    if (allThisYear.length === 0 && (source.isDefault || source.archived)) continue;

    const accounts = [...new Set(thisYear.map((e) => e.accountId))];
    const linked: LinkedAccount =
      accounts.length > 1
        ? { kind: "multiple" }
        : accounts.length === 1
          ? { kind: "account", accountId: accounts[0] as string }
          : source.defaultAccountId
            ? { kind: "account", accountId: source.defaultAccountId }
            : { kind: "none" };

    rows.push({
      source,
      monthMinor: sumIncome(thisYear, periods.month, currency),
      yearMinor: sumIncome(thisYear, periods.year, currency),
      linked,
      onlyVoided: allThisYear.length > 0 && thisYear.length === 0,
    });
  }
  return rows.sort((a, b) => b.yearMinor - a.yearMinor || a.source.name.localeCompare(b.source.name));
}

/** The fields of a recurring rule that say how much a source pays and how often. */
export interface SourceRateRule {
  type: string;
  categoryId: string | null;
  amountMinor: number;
  currency: string;
  frequency: Frequency;
  endDate: IsoDate | null;
  archived: boolean;
}

export interface SourceRate {
  amountMinor: number;
  currency: string;
  frequency: Frequency;
}

/**
 * The rate of each income source ("₹X every month"), taken only from its recurring income
 * rules (a source is an income category; a rule links to it by category_id), never
 * inferred from past entries. A rule counts while it is not archived and has not ended
 * (end date on or after today). One rate per rule, at the rule's current amount (a changed
 * amount applies to future occurrences only, so past entries keep what they were);
 * several rules give several rates, largest first. A source with no such rule is absent.
 */
export function sourceRates(rules: readonly SourceRateRule[], today: IsoDate): Map<string, SourceRate[]> {
  const rates = new Map<string, SourceRate[]>();
  for (const r of rules) {
    if (r.type !== "income" || !r.categoryId || r.archived || (r.endDate !== null && r.endDate < today)) continue;
    const list = rates.get(r.categoryId) ?? [];
    list.push({ amountMinor: r.amountMinor, currency: r.currency, frequency: r.frequency });
    rates.set(r.categoryId, list);
  }
  for (const list of rates.values()) list.sort((a, b) => b.amountMinor - a.amountMinor);
  return rates;
}

/** "every month", "every week", ...: how often a rate repeats, in words. */
export const RATE_WORDS: Readonly<Record<Frequency, string>> = {
  weekly: "every week",
  monthly: "every month",
  quarterly: "every quarter",
  yearly: "every year",
};

/** The Rental income card: all rent-type sources together. */
export function rentalIncome(
  entries: readonly IncomeEntry[],
  sources: readonly IncomeSource[],
  periods: Pick<IncomePeriods, "month" | "year">,
  currency: string,
): { monthMinor: number; yearMinor: number; hasRentSource: boolean } {
  const rentIds = new Set(sources.filter((s) => s.sourceType === "rent").map((s) => s.id));
  const rentEntries = entries.filter((e) => rentIds.has(e.sourceId));
  return {
    monthMinor: sumIncome(rentEntries, periods.month, currency),
    yearMinor: sumIncome(rentEntries, periods.year, currency),
    hasRentSource: sources.some((s) => s.sourceType === "rent" && !s.archived),
  };
}

// ---------------------------------------------------------------- Income page: by period

/** The Income page's period switch. "all": every income entry on record. */
export type IncomePeriodKey = "month" | "year" | "all";

export interface PeriodSourceRow<S extends IncomeSource = IncomeSource> {
  source: S;
  /** Non-voided income in the period, profile currency only. */
  amountMinor: number;
  /** Date of the newest non-voided entry in the period. */
  lastReceivedOn: IsoDate | null;
  /** Note of the newest non-voided entry in the period that has one. */
  note: string | null;
  /** Every entry in the period is voided: listed (history stays reachable), counts as 0. */
  onlyVoided: boolean;
}

export interface PeriodIncome<S extends IncomeSource = IncomeSource> {
  rows: PeriodSourceRow<S>[];
  /** Sum of the rows: the figure the chart and the table's Total row both show. */
  totalMinor: number;
}

/**
 * Income by source for one period (`range` null: all time). Rows: sources with any entry in
 * the period (voided too), plus sources the user added (not archived), as on the Sprint 2
 * panel. Voided entries and entries in another currency never count. Sorted by amount,
 * largest first, then name. Entries are expected newest first (as the loader returns them);
 * ties on a date keep that order for the note.
 */
export function incomeForPeriod<S extends IncomeSource>(
  entries: readonly (IncomeEntry & { note?: string | null })[],
  sources: readonly S[],
  range: DateRange | null,
  currency: string,
): PeriodIncome<S> {
  const inPeriod = range ? entries.filter((e) => isInRange(e.occurredOn, range)) : entries;
  const rows: PeriodSourceRow<S>[] = [];
  for (const source of sources) {
    const all = inPeriod.filter((e) => e.sourceId === source.id);
    if (all.length === 0 && (source.isDefault || source.archived)) continue;
    const live = all.filter((e) => !e.voided);
    // Newest first by date; a stable sort keeps the loader's order within a day.
    const newest = [...live].sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : 0));
    rows.push({
      source,
      amountMinor: addMinor(...live.filter((e) => e.currency === currency).map((e) => e.amountMinor)),
      lastReceivedOn: newest[0]?.occurredOn ?? null,
      note: newest.find((e) => e.note && e.note.trim() !== "")?.note?.trim() ?? null,
      onlyVoided: all.length > 0 && live.length === 0,
    });
  }
  rows.sort((a, b) => b.amountMinor - a.amountMinor || a.source.name.localeCompare(b.source.name));
  return { rows, totalMinor: addMinor(...rows.map((r) => r.amountMinor)) };
}

export interface ChartGroup {
  /** A source id, or "other" for the grouped rest. */
  key: string;
  label: string;
  amountMinor: number;
  /** 0..top-1 for a named group (its colour); null for "Other". */
  colorIndex: number | null;
}

/**
 * Chart groups for income: the `top` largest amounts above zero each get their own colour;
 * the rest are summed into one "Other" group. The groups always add up to the total.
 */
export function topGroupsWithOther<S extends IncomeSource>(rows: readonly PeriodSourceRow<S>[], top = 6): ChartGroup[] {
  const positive = rows.filter((r) => r.amountMinor > 0);
  const named: ChartGroup[] = positive
    .slice(0, top)
    .map((r, i) => ({ key: r.source.id, label: r.source.name, amountMinor: r.amountMinor, colorIndex: i }));
  const rest = positive.slice(top);
  if (rest.length > 0) {
    named.push({ key: "other", label: "Other", amountMinor: addMinor(...rest.map((r) => r.amountMinor)), colorIndex: null });
  }
  return named;
}

/**
 * Geometry for a horizontal bar chart, in basis points of the plot width (0..10000), so
 * negative values draw left of a zero line. Display only: never used for money arithmetic.
 */
export function horizontalBarScale(values: readonly number[]): { zeroBp: number; bars: { startBp: number; lengthBp: number }[] } {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min;
  if (span === 0) return { zeroBp: 0, bars: values.map(() => ({ startBp: 0, lengthBp: 0 })) };
  const zeroBp = Math.round((-min / span) * 10_000) || 0; // never -0
  return {
    zeroBp,
    bars: values.map((v) => {
      const lengthBp = Math.round((Math.abs(v) / span) * 10_000);
      return { startBp: v >= 0 ? zeroBp : Math.max(0, zeroBp - lengthBp), lengthBp };
    }),
  };
}
