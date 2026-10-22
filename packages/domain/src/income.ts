// Period income (CLAUDE.md §5: income in a period is not an account balance).
// Voided entries never count. Sums include only entries in the profile currency.
import { type DateRange, type IsoDate, isInRange } from "./dates";
import { ratioToBasisPoints } from "./format";
import { addMinor } from "./money";

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
