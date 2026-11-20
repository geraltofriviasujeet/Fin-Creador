// Balance feedback after a save (before Sprint 12a): an account's balance before and after
// the entry that was just saved.
//   after  = the account's balance read from the server once the save is confirmed
//            (account_balances view + opening balance).
//   before = after − this save's effect on that account.
//   effect = what the new version posts − what the version it replaced posted (an edit),
//            by the same rule as the account_balances view (postedActivity): income and
//            refunds in, expenses out, a transfer out of one account and into the other, each
//            only when dated on or after that account's opening-balance date.
// All in integer minor units. Nothing here reads a balance; the caller passes the server's.
import type { IsoDate } from "./dates";
import { formatMoney } from "./format";
import { type LedgerEntry, postedActivity } from "./ledger";
import { addMinor } from "./money";

export type BalanceEffectEntry = Pick<LedgerEntry, "type" | "amountMinor" | "occurredOn" | "accountId" | "counterAccountId">;

/** An account's balance as read after the save. */
export interface BalanceAfter {
  accountId: string;
  name: string;
  /** As account pickers show it ("HDFC Bank ··4821"); the name when absent. */
  label?: string;
  currency: string;
  openingBalanceDate: IsoDate;
  afterMinor: number;
}

export interface BalanceChange {
  accountId: string;
  /** Read by screen readers ("HDFC Bank balance now …"). */
  name: string;
  /** Shown on the card ("HDFC Bank ··4821"). */
  label: string;
  currency: string;
  beforeMinor: number;
  afterMinor: number;
}

export type BalanceDirection = "down" | "up" | "none";

const asLedger = (e: BalanceEffectEntry): LedgerEntry => ({ ...e, id: "", currency: "", categoryId: null, voided: false });

/** The accounts an entry touches, in order: the account, then a transfer's other account. */
export const touchedAccounts = (entries: readonly BalanceEffectEntry[]): string[] => [
  ...new Set(entries.flatMap((e) => (e.type === "transfer" && e.counterAccountId ? [e.accountId, e.counterAccountId] : [e.accountId]))),
];

/**
 * Before and after for each account in `after` that the save changed (each account once, in
 * the order given). `added`: the versions the save wrote; `removed`: the versions it replaced.
 * An account the save didn't move (net effect 0) is left out.
 */
export function balanceChanges(
  after: readonly BalanceAfter[],
  added: readonly BalanceEffectEntry[],
  removed: readonly BalanceEffectEntry[] = [],
): BalanceChange[] {
  const accounts = after.map((a) => ({ id: a.accountId, openingBalanceDate: a.openingBalanceDate }));
  const plus = postedActivity(accounts, added.map(asLedger));
  const minus = postedActivity(accounts, removed.map(asLedger));
  const seen = new Set<string>();
  const result: BalanceChange[] = [];
  for (const a of after) {
    if (seen.has(a.accountId)) continue;
    seen.add(a.accountId);
    const p = plus.get(a.accountId)!;
    const m = minus.get(a.accountId)!;
    const effect = addMinor(p.inflowMinor, -p.outflowMinor, -m.inflowMinor, m.outflowMinor);
    if (effect === 0) continue;
    result.push({
      accountId: a.accountId,
      name: a.name,
      label: a.label ?? a.name,
      currency: a.currency,
      beforeMinor: addMinor(a.afterMinor, -effect),
      afterMinor: a.afterMinor,
    });
  }
  return result;
}

export function balanceDirection(change: Pick<BalanceChange, "beforeMinor" | "afterMinor">): BalanceDirection {
  return change.afterMinor < change.beforeMinor ? "down" : change.afterMinor > change.beforeMinor ? "up" : "none";
}

const MINUS = "−";

/** A balance figure, with a true minus sign when below zero ("−₹1,200"). */
export function formatBalance(minor: number, currency: string, locale?: string): string {
  const text = formatMoney(Math.abs(minor), { currency, locale });
  return minor < 0 ? `${MINUS}${text}` : text;
}

/** The change, always signed: "−₹500" for money out, "+₹500" for money in, "₹0" for none. */
export function formatBalanceChange(change: Pick<BalanceChange, "beforeMinor" | "afterMinor" | "currency">, locale?: string): string {
  const delta = addMinor(change.afterMinor, -change.beforeMinor);
  const text = formatMoney(Math.abs(delta), { currency: change.currency, locale });
  return delta < 0 ? `${MINUS}${text}` : delta > 0 ? `+${text}` : text;
}

/** The one line a screen reader hears: "Saved. HDFC Bank balance now ₹51,800." */
export function balanceAnnouncement(changes: readonly BalanceChange[], locale?: string): string {
  return ["Saved.", ...changes.map((c) => `${c.name} balance now ${formatBalance(c.afterMinor, c.currency, locale)}.`)].join(" ");
}

/**
 * The figure shown at `progress` (0 → 1) of a count from `from` to `to`, eased out, in whole
 * minor units. Display only: progress 1 is exactly `to`.
 */
export function countUpValue(from: number, to: number, progress: number): number {
  if (!(progress > 0)) return from;
  if (progress >= 1) return to;
  const eased = 1 - (1 - progress) ** 3;
  return Math.round(from + (to - from) * eased);
}
