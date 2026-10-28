// Reports (Sprint 8c): monthly cash-flow rows and the month-end net worth trend.
//   Cash flow: income and expenses per calendar month in the profile currency (the same
//     entries as the Overview: dashboard_breakdown), net = income − expenses, savings rate =
//     net ÷ income ("—" when there is no income; it can be negative). Transfers, including
//     principal paid to loans, cards and borrowing, are never income or expenses. The month
//     containing today is "so far".
//   Net worth trend: netWorth (net-worth.ts) at each month-end in the profile time zone, and
//     the last point today. Account balances as of each date come from account_balances_at
//     (voided entries never count, "as corrected"); a loan's moratorium interest counts until
//     the day a payment adds it; fixed deposits are valued by formula from their start date
//     until archived; a statutory due counts from the day it was added, minus payments dated
//     on or before that day, until archived; dues use today's amount. Shares, funds and ETFs
//     are left out of every point (only today's price is kept). The trend starts at the first
//     point with anything in it.
import { type CategorySpend, topCategories } from "./dashboard";
import { type DateRange, type IsoDate, monthRange, parseIsoDate } from "./dates";
import { type FixedDeposit, fdValueOn } from "./fixed-deposits";
import type { AccountKind, LiabilityKind } from "./holdings";
import { savingsRateBasisPoints } from "./ledger";
import { addMinor } from "./money";
import { type NetWorth, netWorth } from "./net-worth";

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The first day of the month `offset` months after the one containing `date` (negative: before). */
export function monthStart(date: IsoDate, offset = 0): IsoDate {
  const p = parseIsoDate(date);
  if (!p) throw new RangeError(`Not an ISO date: ${date}`);
  const index = p.year * 12 + (p.month - 1) + offset;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}-01`;
}

/** Most months a report covers (24 calls to dashboard_breakdown; 120 dates is the SQL limit). */
export const MAX_REPORT_MONTHS = 24;
export const DEFAULT_REPORT_MONTHS = 12;

/** Whole months from `from` to `to` (both month starts), inclusive. */
export function monthsBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const months: IsoDate[] = [];
  for (let m = monthStart(from); m <= to; m = monthStart(m, 1)) months.push(m);
  return months;
}

/** The trend's dates: each month-end before the current month, then today. */
export function trendDates(firstMonth: IsoDate, today: IsoDate): IsoDate[] {
  const current = monthStart(today);
  return [...monthsBetween(firstMonth, monthStart(current, -1)).map((m) => monthRange(m).end), today];
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

export interface MonthCashFlow {
  month: IsoDate;
  incomeMinor: number;
  expenseMinor: number;
  /** Expense per category in that month (profile currency). */
  categories: readonly CategorySpend[];
}

export interface CashFlowRow {
  month: IsoDate;
  /** The month's days covered: the whole month, or up to today for the current month. */
  range: DateRange;
  soFar: boolean;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  /** Null when there is no income ("—"); negative when spending is above income. */
  savingsRateBps: number | null;
  /** The month's largest expense category, or null with no spending. */
  topCategory: CategorySpend | null;
}

export interface CashFlowReport {
  rows: CashFlowRow[];
  totals: { incomeMinor: number; expenseMinor: number; netMinor: number; savingsRateBps: number | null };
  /** Top 5 expense categories over the whole range, plus "Everything else". */
  topCategories: CategorySpend[];
}

export function cashFlowReport(months: readonly MonthCashFlow[], today: IsoDate): CashFlowReport {
  const current = monthStart(today);
  const rows = months.map((m): CashFlowRow => {
    const netMinor = addMinor(m.incomeMinor, -m.expenseMinor);
    const soFar = m.month === current;
    return {
      month: m.month,
      range: { start: m.month, end: soFar ? today : monthRange(m.month).end },
      soFar,
      incomeMinor: m.incomeMinor,
      expenseMinor: m.expenseMinor,
      netMinor,
      savingsRateBps: savingsRateBasisPoints({ incomeMinor: m.incomeMinor, netMinor }),
      topCategory: topCategories(m.categories, 1)[0] ?? null,
    };
  });
  const incomeMinor = addMinor(...rows.map((r) => r.incomeMinor));
  const expenseMinor = addMinor(...rows.map((r) => r.expenseMinor));
  const netMinor = addMinor(incomeMinor, -expenseMinor);
  const byCategory = new Map<string | null, number>();
  for (const m of months) for (const c of m.categories) byCategory.set(c.categoryId, addMinor(byCategory.get(c.categoryId) ?? 0, c.expenseMinor));
  return {
    rows,
    totals: { incomeMinor, expenseMinor, netMinor, savingsRateBps: savingsRateBasisPoints({ incomeMinor, netMinor }) },
    topCategories: topCategories([...byCategory].map(([categoryId, expenseMinor]) => ({ categoryId, expenseMinor }))),
  };
}

// ---------------------------------------------------------------------------
// Net worth trend
// ---------------------------------------------------------------------------

export interface SeriesAccount {
  id: string;
  kind: AccountKind | LiabilityKind;
  name: string;
  currency: string;
}

export interface SeriesInput {
  currency: string;
  /** Ascending; the last one is today. */
  dates: readonly IsoDate[];
  accounts: readonly SeriesAccount[];
  /** From account_balances_at: only accounts that count on that date are listed. */
  balances: readonly { asOf: IsoDate; accountId: string; balanceMinor: number }[];
  /** Loans whose moratorium interest is added with the first EMI paid. */
  capitalising: readonly { accountId: string; minor: number; postedOn: IsoDate | null }[];
  deposits: readonly { name: string; currency: string; deposit: FixedDeposit; archivedOn: IsoDate | null }[];
  dues: readonly {
    name: string;
    currency: string;
    amountMinor: number;
    addedOn: IsoDate;
    archivedOn: IsoDate | null;
    payments: readonly { paidOn: IsoDate; minor: number }[];
  }[];
}

export interface SeriesPoint {
  date: IsoDate;
  isToday: boolean;
  worth: NetWorth;
}

const alive = (from: IsoDate, archivedOn: IsoDate | null, date: IsoDate) => from <= date && (archivedOn === null || archivedOn > date);

/** Net worth at each date, shares, funds and ETFs left out; leading points with nothing dropped. */
export function netWorthSeries(input: SeriesInput): SeriesPoint[] {
  const { currency, dates } = input;
  const accountsById = new Map(input.accounts.map((a) => [a.id, a]));
  const points = dates.map((date, i): SeriesPoint => {
    const accounts = input.balances.flatMap((b) => {
      const a = b.asOf === date ? accountsById.get(b.accountId) : undefined;
      return a ? [{ ...a, balanceMinor: b.balanceMinor, archived: false }] : [];
    });
    const worth = netWorth({
      currency,
      today: date,
      accounts: {
        accounts,
        pendingCapitalised: input.capitalising
          .filter((l) => l.postedOn === null || l.postedOn > date)
          .map((l) => ({ accountId: l.accountId, minor: l.minor })),
      },
      investments: {
        holdings: [],
        deposits: input.deposits
          .filter((d) => alive(d.deposit.startDate, d.archivedOn, date))
          .map((d) => ({ name: d.name, currency: d.currency, valueMinor: fdValueOn(d.deposit, date), matured: date >= d.deposit.maturityDate })),
      },
      statutory: input.dues
        .filter((d) => alive(d.addedOn, d.archivedOn, date))
        .map((d) => {
          const paid = addMinor(...d.payments.filter((p) => p.paidOn <= date).map((p) => p.minor));
          return { name: d.name, currency: d.currency, leftMinor: Math.max(addMinor(d.amountMinor, -paid), 0) };
        }),
    });
    return { date, isToday: i === dates.length - 1, worth };
  });
  const first = points.findIndex((p) => p.worth.lines.length > 0 || p.worth.notIncluded.length > 0);
  return first === -1 ? [] : points.slice(first);
}
