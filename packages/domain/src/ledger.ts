// The ledger across all entry types (CLAUDE.md §5).
//   Period income   = eligible income entries dated in the period.
//   Period expenses = eligible expense entries dated in the period.
//   Net cash flow   = period income − period expenses. Transfers are neither.
//   Eligible: not voided and in the profile currency (other currencies are counted
//   separately, never converted).
// Entries are never edited in place: an edit voids the old version and adds a new one that
// points back to it (`replacesId`), so totals only ever see the latest version.
import { type DateRange, type IsoDate, isInRange } from "./dates";
import { ratioToBasisPoints } from "./format";
import { countsTowardBalance } from "./holdings";
import { addMinor } from "./money";

export type EntryType = "income" | "expense" | "transfer";

export interface LedgerEntry {
  id: string;
  type: EntryType;
  /** Always positive; the type gives the direction. */
  amountMinor: number;
  currency: string;
  occurredOn: IsoDate;
  /** Income: the account it went into. Expense and transfer: the account it left. */
  accountId: string;
  /** Transfer only: the account it went into. */
  counterAccountId: string | null;
  /** Income and expense only. */
  categoryId: string | null;
  voided: boolean;
  /** The earlier version this entry replaced (an edit), if any. */
  replacesId?: string | null;
}

export interface PeriodTotals {
  incomeMinor: number;
  expenseMinor: number;
  /** Income − expenses; negative when more went out than came in. */
  netMinor: number;
  incomeCount: number;
  expenseCount: number;
  transferCount: number;
  /** Entries in the period in another currency: listed, not totalled. */
  otherCurrencyCount: number;
}

export function periodTotals(entries: readonly LedgerEntry[], range: DateRange, currency: string): PeriodTotals {
  const inPeriod = entries.filter((e) => !e.voided && isInRange(e.occurredOn, range));
  const same = inPeriod.filter((e) => e.currency === currency);
  const income = same.filter((e) => e.type === "income");
  const expense = same.filter((e) => e.type === "expense");
  const incomeMinor = addMinor(...income.map((e) => e.amountMinor));
  const expenseMinor = addMinor(...expense.map((e) => e.amountMinor));
  return {
    incomeMinor,
    expenseMinor,
    netMinor: addMinor(incomeMinor, -expenseMinor),
    incomeCount: income.length,
    expenseCount: expense.length,
    transferCount: same.filter((e) => e.type === "transfer").length,
    otherCurrencyCount: inPeriod.length - same.length,
  };
}

/** Share of income kept (net ÷ income) in basis points; null when there was no income. */
export function savingsRateBasisPoints(totals: Pick<PeriodTotals, "incomeMinor" | "netMinor">): number | null {
  if (totals.incomeMinor <= 0) return null;
  return ratioToBasisPoints(totals.netMinor, totals.incomeMinor);
}

export interface PostedActivity {
  inflowMinor: number;
  outflowMinor: number;
}

/**
 * Posted inflow and outflow per account, the same rule as the account_balances view:
 * not voided and dated on or after that account's opening-balance date. A transfer is an
 * outflow of `accountId` and an inflow of `counterAccountId`, each checked against its own
 * account's date. Feed the result to accountBalance / summarizeHoldings.
 */
export function postedActivity(
  accounts: readonly { id: string; openingBalanceDate: IsoDate }[],
  entries: readonly LedgerEntry[],
): Map<string, PostedActivity> {
  const result = new Map<string, PostedActivity>(accounts.map((a) => [a.id, { inflowMinor: 0, outflowMinor: 0 }]));
  const opening = new Map(accounts.map((a) => [a.id, a.openingBalanceDate]));
  const post = (accountId: string | null, occurredOn: IsoDate, amount: number, side: keyof PostedActivity) => {
    const date = accountId ? opening.get(accountId) : undefined;
    const row = accountId ? result.get(accountId) : undefined;
    if (!row || date === undefined || !countsTowardBalance(occurredOn, date)) return;
    row[side] = addMinor(row[side], amount);
  };
  for (const e of entries) {
    if (e.voided) continue;
    if (e.type === "income") post(e.accountId, e.occurredOn, e.amountMinor, "inflowMinor");
    else post(e.accountId, e.occurredOn, e.amountMinor, "outflowMinor");
    if (e.type === "transfer") post(e.counterAccountId, e.occurredOn, e.amountMinor, "inflowMinor");
  }
  return result;
}

/** Entries no later version replaces: what lists and totals show. */
export function currentVersions<E extends LedgerEntry>(entries: readonly E[]): E[] {
  const replaced = new Set(entries.map((e) => e.replacesId).filter((id): id is string => Boolean(id)));
  return entries.filter((e) => !replaced.has(e.id));
}

/** Every version of an entry, oldest first, ending with `id`. */
export function versionHistory<E extends LedgerEntry>(entries: readonly E[], id: string): E[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const chain: E[] = [];
  const seen = new Set<string>();
  for (let e = byId.get(id); e && !seen.has(e.id); e = e.replacesId ? byId.get(e.replacesId) : undefined) {
    seen.add(e.id);
    chain.unshift(e);
  }
  return chain;
}
