// Due items (Sprint 8a): anything with a due date that is paid from an account. Loan EMIs and
// moratorium interest (8a), credit-card bills and borrowing due dates (8b) and statutory dues
// (8d) use the same rows, reminders and checks.
//
// Reminders are in-app only and derived from stored dates (no scheduled job). Entries carry
// a date, not a time of day, so "within 24 hours" means due (or planned) tomorrow, in the
// person's time zone; `today` is their local date.
import { type IsoDate, addDays } from "./dates";
import { addMinor } from "./money";

export const DUE_KINDS = ["loan_emi", "loan_interest", "card_bill", "borrowing_due", "statutory_due"] as const;
export type DueKind = (typeof DUE_KINDS)[number];

/** Pending: to pay. Paid: posted from an account. Before tracking: paid before the loan was added (never posted). */
export const DUE_STATUSES = ["pending", "paid", "before_tracking"] as const;
export type DueStatus = (typeof DUE_STATUSES)[number];

export interface DueItemLike {
  id: string;
  dueDate: IsoDate;
  status: DueStatus;
  /** "Will pay later": the date the person plans to pay. */
  plannedOn: IsoDate | null;
  amountDueMinor: number;
  /** Its loan, card or borrowing is archived: no reminders, nothing to pay. */
  sourceArchived?: boolean;
  /** A card bill whose minimum is already paid (cardBillState): no reminders. */
  covered?: boolean;
}

export type ReminderReason = "overdue" | "due_today" | "planned_today" | "due_tomorrow" | "planned_tomorrow";

/** Most urgent first; an item shows once, for its most urgent reason. */
export const REMINDER_ORDER: readonly ReminderReason[] = ["overdue", "due_today", "planned_today", "due_tomorrow", "planned_tomorrow"];

export interface Reminder<T extends DueItemLike = DueItemLike> {
  item: T;
  reason: ReminderReason;
  /** Overdue only: whole days past the due date. */
  daysOverdue: number;
}

function daysAfter(from: IsoDate, to: IsoDate): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** The reason a pending item needs attention on `today`, or null. */
export function reminderReason(item: DueItemLike, today: IsoDate): ReminderReason | null {
  if (item.status !== "pending" || item.sourceArchived || item.covered) return null;
  const tomorrow = addDays(today, 1);
  if (item.dueDate < today) return "overdue";
  if (item.dueDate === today) return "due_today";
  if (item.plannedOn === today) return "planned_today";
  if (item.dueDate === tomorrow) return "due_tomorrow";
  if (item.plannedOn === tomorrow) return "planned_tomorrow";
  return null;
}

/**
 * The bell and the Overview "Due soon" card: pending items overdue, due today or tomorrow,
 * or planned for today or tomorrow. Sorted by urgency, then due date, then id (stable).
 */
export function dueReminders<T extends DueItemLike>(items: readonly T[], today: IsoDate): Reminder<T>[] {
  const out: Reminder<T>[] = [];
  for (const item of items) {
    const reason = reminderReason(item, today);
    if (reason) out.push({ item, reason, daysOverdue: reason === "overdue" ? daysAfter(item.dueDate, today) : 0 });
  }
  const rank = (r: ReminderReason) => REMINDER_ORDER.indexOf(r);
  return out.sort(
    (a, b) => rank(a.reason) - rank(b.reason) || a.item.dueDate.localeCompare(b.item.dueDate) || a.item.id.localeCompare(b.item.id),
  );
}

/** The earliest pending item (by due date, then id), or null. */
export function nextPending<T extends DueItemLike>(items: readonly T[]): T | null {
  let next: T | null = null;
  for (const item of items) {
    if (item.status !== "pending" || item.sourceArchived) continue;
    if (!next || item.dueDate < next.dueDate || (item.dueDate === next.dueDate && item.id < next.id)) next = item;
  }
  return next;
}

/**
 * How much more the account needs to pay `amountMinor`: 0 when the balance covers it. A
 * shortfall is a warning: the person may still "Pay anyway" (the database refuses it unless
 * told so).
 */
export function shortfallMinor(balanceMinor: number, amountMinor: number): number {
  if (!Number.isSafeInteger(balanceMinor) || !Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new RangeError("Amounts must be safe integers");
  return amountMinor > balanceMinor ? addMinor(amountMinor, -balanceMinor) : 0;
}
