// Safe to spend today and the runs-short warning (Sprint 13a PR 3). The rule is in
// docs/sprint-plan.md, "Safe to spend rule (approved 2026-11-23)":
//
//   Safe to spend today = (money left − bills due before the next income − goal saving still
//   due before the next income) ÷ days until the next income.
//
// Pure and exact: money in integer minor units, the division rounded down to a whole minor
// unit. Only the display rounds to whole units (down for amounts to spend, up for a
// shortfall). "Today" is the date in the profile time zone, read from the bundled offset table
// (local-time.ts), so no Intl is used and web and phone get the same figure.
import { type IsoDate, addDays, monthRange, parseIsoDate } from "./dates";
import { currencyMinorDigits } from "./currency";
import { type AccountKind, type LiabilityKind, isMoneyAccountKind } from "./holdings";
import { localDateTime } from "./local-time";
import { addMinor } from "./money";
import { type Schedule, isOccurrence, latestOccurrenceOnOrBefore, nextOccurrenceAfter } from "./recurrence";

export interface SafeToSpendAccount {
  id: string;
  name: string;
  /** Only money accounts (bank, cash, other) count; liability accounts never do. */
  kind: AccountKind | LiabilityKind;
  currency: string;
  archived: boolean;
  /** Balance at the start of today: the current balance without today's posted entries. */
  startOfTodayMinor: number;
}

export interface SafeToSpendIncome {
  id: string;
  name: string;
  schedule: Schedule;
  /** Expected amount per occurrence; the largest picks the main income (goal due dates). */
  amountMinor: number;
  currency: string;
  archived: boolean;
  /** Entries posted from this income today (not voided), by the account they went into. */
  recordedToday: readonly { accountId: string; amountMinor: number }[];
}

export interface SafeToSpendBill {
  id: string;
  /** "Rent", "HDFC card", "Car loan EMI". */
  name: string;
  dueDate: IsoDate;
  /** Still to pay. Paid or skipped bills are not passed in. */
  amountMinor: number;
  currency: string;
  /** The account it is paid from, or null when none is set (counted in the total only). */
  accountId: string | null;
}

export interface SafeToSpendGoal {
  id: string;
  name: string;
  monthlySavingMinor: number;
  currency: string;
  /** Money put toward the goal (recent entries are enough: the current pay cycle or month). */
  contributions: readonly { date: IsoDate; amountMinor: number }[];
}

export interface SafeToSpendInput {
  now: Date;
  /** Profile time zone (IANA). An unknown zone falls back as resolveTimeZone describes. */
  timeZone: string;
  /** Profile currency: only accounts, incomes, bills and goals in it count. */
  currency: string;
  accounts: readonly SafeToSpendAccount[];
  incomes: readonly SafeToSpendIncome[];
  bills: readonly SafeToSpendBill[];
  goals: readonly SafeToSpendGoal[];
  /** Expenses dated today in the profile currency. Reduces "left today" only. */
  spentTodayMinor: number;
}

export interface AccountShortfall {
  accountId: string;
  accountName: string;
  /** The first bill that takes the account below zero. */
  bill: { id: string; name: string; dueDate: IsoDate };
  /** How far below zero the account is right after that bill. */
  shortAfterBillMinor: number;
  /** How far below zero it is after every bill in the window. */
  shortByEndMinor: number;
}

interface SafeToSpendCommon {
  today: IsoDate;
  /** Last day of the window (inclusive): the day before the next income, or the month's end. */
  lastDay: IsoDate;
  /** Counted accounts' balances at the start of today, plus income recorded today on payday. */
  moneyLeftMinor: number;
  /** Unpaid bills due from today through `lastDay`, oldest first. */
  bills: SafeToSpendBill[];
  billsMinor: number;
  goalSavingMinor: number;
  /** money left − bills − goal saving. Negative when the bills and goals need more. */
  availableMinor: number;
  /** −availableMinor when that is negative, else 0. */
  shortMinor: number;
  /** Accounts whose bills in the window take them below zero, in account order. */
  shortAccounts: AccountShortfall[];
}

export type SafeToSpendResult =
  | (SafeToSpendCommon & {
      kind: "daily";
      nextIncomeDate: IsoDate;
      /** Today through the day before the next income: at least 1. */
      days: number;
      /** availableMinor ÷ days, rounded down to a whole minor unit; 0 when short. */
      dailyMinor: number;
      /** dailyMinor − today's spending (negative once today's spending passes it). */
      leftTodayMinor: number;
      /** Today is an income date but that income is not recorded yet, so it is not counted. */
      paydayPending: boolean;
    })
  | (SafeToSpendCommon & {
      /** No recurring income: "Money left this month" and a "Set your income date" prompt. */
      kind: "month";
      needsIncomeDate: true;
    });

function checkMinor(value: number, name: string, allowNegative = false) {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new RangeError(`${name} must be a ${allowNegative ? "" : "non-negative "}safe integer of minor units`);
  }
}

function dayNumber(date: IsoDate): number {
  const p = parseIsoDate(date);
  if (!p) throw new RangeError(`Not an ISO date: ${date}`);
  return Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;
}

/** Whole days from `from` to `to` (to − from). */
const daysBetween = (from: IsoDate, to: IsoDate) => dayNumber(to) - dayNumber(from);

/** Earliest next occurrence after `today` among the incomes, with the incomes that have one. */
export function nextIncomeDate(incomes: readonly SafeToSpendIncome[], today: IsoDate): IsoDate | null {
  let next: IsoDate | null = null;
  for (const income of incomes) {
    const date = nextOccurrenceAfter(income.schedule, today);
    if (date && (next === null || date < next)) next = date;
  }
  return next;
}

/**
 * The income goal saving falls due with: the largest expected amount among incomes that still
 * have dates ahead (ties: the earlier start date, then id).
 */
function mainIncome(incomes: readonly SafeToSpendIncome[], today: IsoDate): SafeToSpendIncome | null {
  const ongoing = incomes.filter((i) => nextOccurrenceAfter(i.schedule, today) !== null);
  ongoing.sort(
    (a, b) =>
      b.amountMinor - a.amountMinor ||
      (a.schedule.startDate < b.schedule.startDate ? -1 : a.schedule.startDate > b.schedule.startDate ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return ongoing[0] ?? null;
}

/** Monthly saving still due since `dueDate`: the saving minus what was put toward it since then. */
function goalStillDue(goals: readonly SafeToSpendGoal[], dueDate: IsoDate | null, today: IsoDate): number {
  if (dueDate === null) return 0;
  return addMinor(
    ...goals.map((goal) => {
      const put = addMinor(...goal.contributions.filter((c) => c.date >= dueDate && c.date <= today).map((c) => c.amountMinor));
      return Math.max(0, addMinor(goal.monthlySavingMinor, -put));
    }),
  );
}

function shortfalls(
  accounts: readonly { account: SafeToSpendAccount; balanceMinor: number }[],
  bills: readonly SafeToSpendBill[],
): AccountShortfall[] {
  const result: AccountShortfall[] = [];
  for (const { account, balanceMinor } of accounts) {
    let running = balanceMinor;
    let first: Omit<AccountShortfall, "shortByEndMinor"> | null = null;
    for (const bill of bills) {
      if (bill.accountId !== account.id) continue;
      running = addMinor(running, -bill.amountMinor);
      if (first === null && running < 0) {
        first = {
          accountId: account.id,
          accountName: account.name,
          bill: { id: bill.id, name: bill.name, dueDate: bill.dueDate },
          shortAfterBillMinor: -running,
        };
      }
    }
    if (first) result.push({ ...first, shortByEndMinor: -running });
  }
  return result;
}

/** Safe to spend today, or money left this month when there is no recurring income. */
export function safeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const { currency } = input;
  checkMinor(input.spentTodayMinor, "Today's spending");
  for (const a of input.accounts) checkMinor(a.startOfTodayMinor, "Account balance", true);
  for (const i of input.incomes) {
    checkMinor(i.amountMinor, "Income amount");
    for (const r of i.recordedToday) checkMinor(r.amountMinor, "Recorded income");
  }
  for (const b of input.bills) checkMinor(b.amountMinor, "Bill amount");
  for (const g of input.goals) {
    checkMinor(g.monthlySavingMinor, "Goal saving");
    for (const c of g.contributions) checkMinor(c.amountMinor, "Goal contribution");
  }

  const today = localDateTime(input.now, input.timeZone).date;
  const counted = input.accounts.filter((a) => !a.archived && isMoneyAccountKind(a.kind) && a.currency === currency);
  const incomes = input.incomes.filter((i) => !i.archived && i.currency === currency);
  const goals = input.goals.filter((g) => g.currency === currency);
  const next = nextIncomeDate(incomes, today);

  // Payday: an income due today and already recorded counts in money left.
  const payday = next === null ? [] : incomes.filter((i) => isOccurrence(i.schedule, today));
  const recordedInto = new Map<string, number>();
  for (const income of payday) {
    for (const r of income.recordedToday) recordedInto.set(r.accountId, addMinor(recordedInto.get(r.accountId) ?? 0, r.amountMinor));
  }
  const balances = counted.map((account) => ({
    account,
    balanceMinor: addMinor(account.startOfTodayMinor, recordedInto.get(account.id) ?? 0),
  }));
  const moneyLeftMinor = addMinor(...balances.map((b) => b.balanceMinor));

  const lastDay = next === null ? monthRange(today).end : addDays(next, -1);
  const bills = input.bills
    .filter((b) => b.currency === currency && b.dueDate >= today && b.dueDate <= lastDay)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const billsMinor = addMinor(...bills.map((b) => b.amountMinor));

  // Goal saving falls due on the main income's date (a monthly main income), so it follows
  // the pay cycle; otherwise, and with no income, on the 1st of the calendar month.
  const main = next === null ? null : mainIncome(incomes, today);
  const goalDueDate =
    main && main.schedule.frequency === "monthly" ? latestOccurrenceOnOrBefore(main.schedule, today) : monthRange(today).start;
  const goalSavingMinor = goalStillDue(goals, goalDueDate, today);

  const availableMinor = addMinor(moneyLeftMinor, -billsMinor, -goalSavingMinor);
  const common: SafeToSpendCommon = {
    today,
    lastDay,
    moneyLeftMinor,
    bills,
    billsMinor,
    goalSavingMinor,
    availableMinor,
    shortMinor: availableMinor < 0 ? -availableMinor : 0,
    shortAccounts: shortfalls(balances, bills),
  };

  if (next === null) return { ...common, kind: "month", needsIncomeDate: true };

  const days = daysBetween(today, next);
  const dailyMinor = availableMinor > 0 ? Number(BigInt(availableMinor) / BigInt(days)) : 0;
  return {
    ...common,
    kind: "daily",
    nextIncomeDate: next,
    days,
    dailyMinor,
    leftTodayMinor: addMinor(dailyMinor, -input.spentTodayMinor),
    paydayPending: payday.some((i) => i.recordedToday.length === 0),
  };
}

function wholeUnit(currency: string): number {
  return 10 ** currencyMinorDigits(currency);
}

/** Rounded down to a whole unit of the currency, in minor units (₹1,090.90 → ₹1,090). */
export function floorToWholeMinor(amountMinor: number, currency: string): number {
  checkMinor(amountMinor, "Amount", true);
  const unit = wholeUnit(currency);
  return amountMinor - (((amountMinor % unit) + unit) % unit);
}

/** Rounded up to a whole unit of the currency, so a shortfall is never understated. */
export function ceilToWholeMinor(amountMinor: number, currency: string): number {
  const floor = floorToWholeMinor(amountMinor, currency);
  return floor === amountMinor ? floor : addMinor(floor, wholeUnit(currency));
}
