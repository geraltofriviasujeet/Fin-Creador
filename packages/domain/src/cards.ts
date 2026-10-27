// Credit cards and informal borrowing (Sprint 8b). Figures the database also checks:
//   * Cycle dates: the statement day and due day of a month, clamped to the month end; the due
//     date is the first due-day date after the statement date (so a due day earlier than the
//     statement day falls in the next month). Same as public.card_cycle_date / card_due_date (parity test:
//     supabase/tests/database/card_dates_parity.test.sql).
//   * Bill = statement total − card EMIs on it (paid from the loan row, never from the bill).
//   * Difference: bill − owed on the statement date, when positive (offered as an expense).
//   * Paid towards a bill: transfers into the card dated on or after its statement date
//     (public.card_bill_paid). A bill is settled when that covers it; reminders stop once the
//     minimum is covered.
import { type IsoDate, daysInMonth, parseIsoDate } from "./dates";
import { addMinor } from "./money";

function mustParse(date: IsoDate) {
  const parts = parseIsoDate(date);
  if (!parts) throw new RangeError(`Invalid date: ${date}`);
  return parts;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function checkDay(day: number) {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError("Day must be 1 to 31");
}

/** Day `day` of the month `monthsAhead` after `date`'s month, clamped to the month end. */
export function cardCycleDate(day: number, date: IsoDate, monthsAhead = 0): IsoDate {
  checkDay(day);
  const { year, month } = mustParse(date);
  const index = year * 12 + (month - 1) + monthsAhead;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${pad(y, 4)}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

/** The due date of a statement dated `statementDate`: the first date after it on the due day. */
export function cardDueDate(statementDate: IsoDate, dueDay: number): IsoDate {
  const sameMonth = cardCycleDate(dueDay, statementDate);
  return sameMonth > statementDate ? sameMonth : cardCycleDate(dueDay, statementDate, 1);
}

/**
 * The latest statement date strictly before `today` (the cycle whose statement may now be
 * entered) and the one before it.
 */
export function latestStatementCycle(statementDay: number, today: IsoDate): { statementDate: IsoDate; previousDate: IsoDate } {
  const thisMonth = cardCycleDate(statementDay, today);
  const statementDate = thisMonth < today ? thisMonth : cardCycleDate(statementDay, today, -1);
  return { statementDate, previousDate: cardCycleDate(statementDay, statementDate, -1) };
}

/**
 * "Add your <card> statement": from the day after the statement day until a statement dated
 * after the previous cycle's statement date is entered. Not for an archived card, nor for a
 * cycle that ended before the card was added.
 */
export function statementReminder(
  card: { statementDay: number; trackingStartedOn: IsoDate; archived: boolean },
  statementDates: readonly IsoDate[],
  today: IsoDate,
): { statementDate: IsoDate; dueDate: null } | null {
  if (card.archived) return null;
  const { statementDate, previousDate } = latestStatementCycle(card.statementDay, today);
  if (statementDate < card.trackingStartedOn) return null;
  if (statementDates.some((d) => d > previousDate)) return null;
  return { statementDate, dueDate: null };
}

/** The bill: statement total minus card EMIs on it, never below zero. */
export function cardBillMinor(totalMinor: number, emiIncludedMinor: number): number {
  if (emiIncludedMinor > totalMinor) throw new RangeError("EMIs can't be more than the total");
  return addMinor(totalMinor, -emiIncludedMinor);
}

/** What the statement shows beyond what is logged as owed on its date (0 when nothing is missing). */
export function statementDifferenceMinor(billMinor: number, owedAtStatementMinor: number | null): number {
  if (owedAtStatementMinor === null) return 0;
  return Math.max(addMinor(billMinor, -owedAtStatementMinor), 0);
}

export type CardBillState = "paid" | "minimum_paid" | "part_paid" | "unpaid";

/**
 * A bill's progress. `closed`: paid through Pay bill (a part-paid bill is closed; the rest
 * stays owed on the card). `covered` stops reminders: paid in full, or at least the minimum.
 */
export function cardBillState(bill: { amountDueMinor: number; minimumDueMinor: number | null; paidMinor: number; closed: boolean }): {
  state: CardBillState;
  leftMinor: number;
  covered: boolean;
} {
  const leftMinor = Math.max(addMinor(bill.amountDueMinor, -bill.paidMinor), 0);
  const minimumMet = bill.minimumDueMinor !== null && bill.paidMinor >= bill.minimumDueMinor;
  const state: CardBillState =
    leftMinor === 0 ? "paid" : minimumMet ? "minimum_paid" : bill.paidMinor > 0 || bill.closed ? "part_paid" : "unpaid";
  return { state, leftMinor, covered: leftMinor === 0 || minimumMet || bill.closed };
}

/** Pay bill's default amount: the bill minus what is already paid, at most what the card owes. */
export function payBillDefaultMinor(amountDueMinor: number, paidMinor: number, owedMinor: number): number {
  return Math.max(Math.min(addMinor(amountDueMinor, -paidMinor), owedMinor), 0);
}

export type UtilisationLevel = "ok" | "high" | "over";

/** Limit used, in basis points (rounded down), and the 80% / 100% warning level. */
export function cardUtilisation(owedMinor: number, limitMinor: number): { bps: number; level: UtilisationLevel } {
  if (!Number.isSafeInteger(owedMinor) || !Number.isSafeInteger(limitMinor) || limitMinor <= 0) throw new RangeError("Amounts must be safe integers");
  const owed = Math.max(owedMinor, 0);
  const bps = Number((BigInt(owed) * 10_000n) / BigInt(limitMinor));
  return { bps, level: bps >= 10_000 ? "over" : bps >= 8_000 ? "high" : "ok" };
}

/** A borrowing's due item is paid once nothing is owed; otherwise it stays pending (overdue once past). */
export function borrowingDueStatus(owedMinor: number): "paid" | "pending" {
  return owedMinor > 0 ? "pending" : "paid";
}

/**
 * "EMIs included" on a statement: card EMIs (of loans linked to the card) due in its cycle,
 * after the previous statement date and up to this one.
 */
export function emisInCycle(emis: readonly { dueDate: IsoDate; amountMinor: number }[], statementDate: IsoDate, statementDay: number): number {
  const previous = cardCycleDate(statementDay, statementDate, -1);
  return addMinor(...emis.filter((e) => e.dueDate > previous && e.dueDate <= statementDate).map((e) => e.amountMinor));
}
