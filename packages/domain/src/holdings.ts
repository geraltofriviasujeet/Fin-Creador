// Account balances and the "where your money is" totals (CLAUDE.md §5).
//   Account balance = opening balance + posted inflows − posted outflows.
//   An entry is posted to the balance when it is not voided and is dated on or after the
//   account's opening-balance date (the opening balance is the balance at the start of
//   that day). The database view account_balances supplies the posted sums.
//   Total available = sum of active accounts' balances in the profile currency.
import type { IsoDate } from "./dates";
import { addMinor } from "./money";

export type AccountKind = "bank" | "cash" | "other";
/**
 * Accounts that hold money: the only ones in Total available, account pickers and the
 * Accounts page. Liability accounts (below) are never one of them.
 */
export const MONEY_ACCOUNT_KINDS: readonly AccountKind[] = ["bank", "cash", "other"];
export const isMoneyAccountKind = (kind: string): kind is AccountKind => (MONEY_ACCOUNT_KINDS as readonly string[]).includes(kind);

/**
 * Liability accounts: a loan's (Sprint 8a), a credit card's and a borrowing's (8b). Their
 * balance is minus what is owed. Same list as public.is_liability_kind in the database.
 */
export const LIABILITY_ACCOUNT_KINDS = ["loan", "card", "borrowing"] as const;
export type LiabilityKind = (typeof LIABILITY_ACCOUNT_KINDS)[number];
export const isLiabilityKind = (kind: string): kind is LiabilityKind => (LIABILITY_ACCOUNT_KINDS as readonly string[]).includes(kind);
export const LIABILITY_KIND_LABELS: Record<LiabilityKind, string> = { loan: "loan", card: "card", borrowing: "borrowed" };
export type BankType = "savings" | "current";

export interface AccountWithActivity {
  id: string;
  /** A liability kind is accepted and never counted (summarizeHoldings filters it out). */
  kind: AccountKind | LiabilityKind;
  bankType: BankType | null;
  currency: string;
  openingBalanceMinor: number;
  openingBalanceDate: IsoDate;
  archived: boolean;
  /** Posted inflows (not voided, on or after the opening-balance date). */
  inflowMinor: number;
  /** Posted outflows (same rule). */
  outflowMinor: number;
}

export function accountBalance(account: AccountWithActivity): number {
  return addMinor(account.openingBalanceMinor, account.inflowMinor, -account.outflowMinor);
}

/** Whether an entry dated `occurredOn` changes the account's balance. */
export function countsTowardBalance(occurredOn: IsoDate, openingBalanceDate: IsoDate): boolean {
  return occurredOn >= openingBalanceDate;
}

export interface HoldingRow<A extends AccountWithActivity = AccountWithActivity> {
  account: A;
  balanceMinor: number;
  /** False for accounts in another currency: listed, never converted or totalled. */
  inTotal: boolean;
}

export interface HoldingsSummary<A extends AccountWithActivity = AccountWithActivity> {
  currency: string;
  totalAvailableMinor: number;
  moneyInBanksMinor: number;
  cashInHandMinor: number;
  bankCount: number;
  savingsCount: number;
  currentCount: number;
  /** Active accounts in display order: banks, then cash, then other. */
  rows: HoldingRow<A>[];
  archived: A[];
}

const KIND_ORDER: Record<AccountKind, number> = { bank: 0, cash: 1, other: 2 };

export function summarizeHoldings<A extends AccountWithActivity>(
  accounts: readonly A[],
  profileCurrency: string,
): HoldingsSummary<A> {
  // Defensive: a liability account read with a loose kind is never counted.
  const active = accounts.filter((a) => !a.archived && isMoneyAccountKind(a.kind));
  const rows = active
    .map((account) => ({ account, balanceMinor: accountBalance(account), inTotal: account.currency === profileCurrency }))
    .sort((x, y) => KIND_ORDER[x.account.kind as AccountKind] - KIND_ORDER[y.account.kind as AccountKind]);
  const sum = (filter: (row: HoldingRow<A>) => boolean) =>
    addMinor(...rows.filter((r) => r.inTotal && filter(r)).map((r) => r.balanceMinor));
  const banks = active.filter((a) => a.kind === "bank");

  return {
    currency: profileCurrency,
    totalAvailableMinor: sum(() => true),
    moneyInBanksMinor: sum((r) => r.account.kind === "bank"),
    cashInHandMinor: sum((r) => r.account.kind === "cash"),
    bankCount: banks.length,
    savingsCount: banks.filter((a) => a.bankType === "savings").length,
    currentCount: banks.filter((a) => a.bankType === "current").length,
    rows,
    archived: accounts.filter((a) => a.archived && isMoneyAccountKind(a.kind)),
  };
}
