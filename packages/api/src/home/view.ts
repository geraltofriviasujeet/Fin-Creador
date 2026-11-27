import {
  type BudgetStatus,
  type IsoDate,
  type SafeToSpendAccount,
  type SafeToSpendBill,
  type SafeToSpendGoal,
  type SafeToSpendIncome,
  type SafeToSpendResult,
  type Schedule,
  type SpendLimitToday,
  addDays,
  addMinor,
  accountBalance,
  latestOccurrenceOnOrBefore,
  localDateTime,
  monthRange,
  everydaySpendingMinor,
  limitExceedsMoneyAfterBills,
  nextIncomeDate,
  occurrencesBetween,
  postedActivity,
  safeToSpend,
  spendLimitToday,
  summarizeHoldings,
} from "@fin-creador/domain"
import type { GoalsView } from "../goals/view"
import { type BellReminder, bellReminders } from "../loans/load"
import type { LoansView } from "../loans/view"
import { type RecurringData, UPCOMING_DAYS } from "../recurring"
import type { SpendLimit } from "../spend-limit/load"
import type { LedgerAccount, LedgerCategory, TransactionsContext } from "../transactions/types"

// The phone's Home (Sprint 13a PR 4), built from the loaders the web already uses, with the
// shared domain rules: Safe to spend (packages/domain safeToSpend), Coming up, Where it went,
// Your money and the bell. Pure, so the web Overview (13a PR 5) can show the same figures.

/** At most this many bills on Home's "Coming up"; "See all" opens Recurring. */
export const HOME_COMING_UP_LIMIT = 5
/** Top categories on "Where it went". */
export const HOME_CATEGORY_LIMIT = 4

/** An entry dated today, as stored (every row, voided ones included, so it matches account_balances). */
export type TodayEntry = {
  id: string
  type: "income" | "expense" | "transfer" | "refund"
  amountMinor: number
  currency: string
  occurredOn: IsoDate
  accountId: string
  counterAccountId: string | null
  categoryId: string | null
  voided: boolean
  recurringRuleId: string | null
  /** Part of an EMI, card bill, repayment or statutory due payment (due_payment_id or liability_payment_id). */
  paymentId: string | null
}

export type HomeBillKind = "bill" | "emi" | "card" | "borrowing" | "statutory"

/** A bill, EMI, card due, repayment or statutory due still to pay. */
export type HomeBill = SafeToSpendBill & {
  kind: HomeBillKind
  /** Due before today and still unpaid: counted as due now, listed first as "Overdue". */
  overdue: boolean
  /** The account it is paid from, or null when none is set. */
  accountName: string | null
  /** Recurring bills: the category's icon key (for the row's icon). */
  icon: string | null
}

export type HomeAccount = { id: string; label: string; kind: "bank" | "cash" | "other"; currency: string; balanceMinor: number; inTotal: boolean }

export type HomeCategory = { id: string; name: string; icon: string | null; spentMinor: number; budget: BudgetStatus | null }

/**
 * The daily spend limit as Home shows it: what was set, today's figure (packages/domain
 * spendLimitToday) and the safety note (decisions log 2026-11-24 "Daily spend limit: final rule").
 */
export type HomeSpendLimit = SpendLimit & {
  today: SpendLimitToday
  /** The daily limit × days left in Safe to spend's window is more than money left after bills. */
  exceedsMoneyAfterBills: boolean
}

export type HomeData = {
  /** Display name for the greeting (first word only is shown), or null. */
  name: string | null
  today: IsoDate
  timeZone: string
  currency: string
  /** No account and no entry yet: Home shows its first-run state. */
  isNew: boolean
  safe: SafeToSpendResult
  /**
   * Spending today in the profile currency (the hero's bar): expenses net of refunds, leaving
   * out bills from recurring rules and EMI, card, repayment and statutory payments, never below 0.
   */
  spentTodayMinor: number
  /** The daily spend limit, or null when none is set (or it is in another currency than the profile's). */
  limit: HomeSpendLimit | null
  /** Overdue bills, then those due from today to UPCOMING_DAYS ahead, oldest first, at most HOME_COMING_UP_LIMIT. */
  comingUp: HomeBill[]
  /** How many more are due in that time than comingUp shows. */
  comingUpMore: number
  /** This month: spending in the profile currency by category (top HOME_CATEGORY_LIMIT) with budgets. */
  where: { spentMinor: number; categories: HomeCategory[] }
  /** Active money accounts (largest balance first) and Total available. */
  money: { totalMinor: number; accounts: HomeAccount[] }
  /** The bell: the same list as the web's (loadBellReminders). */
  reminders: BellReminder[]
}

export type HomeInput = {
  now: Date
  name: string | null
  context: TransactionsContext
  recurring: RecurringData
  loans: LoansView
  goals: GoalsView
  /** This month's expense per category, profile currency (GoalsData.spending). */
  spending: ReadonlyMap<string, number>
  todayEntries: readonly TodayEntry[]
  /** The daily spend limit (loadSpendLimit), or null. */
  spendLimit: SpendLimit | null
  /** Expense and refund entries from the limit's period start to yesterday ([] without a limit; loadSpendLimitInputs). */
  earlierEntries: readonly TodayEntry[]
}

const toSchedule = (r: { frequency: Schedule["frequency"]; startDate: IsoDate; endDate: IsoDate | null }): Schedule => ({
  frequency: r.frequency,
  startDate: r.startDate,
  endDate: r.endDate,
})

/**
 * Each money account's balance at the start of today: its balance without today's posted
 * entries (the same rows and rule as account_balances).
 */
export function startOfTodayAccounts(accounts: readonly LedgerAccount[], todayEntries: readonly TodayEntry[]): SafeToSpendAccount[] {
  const money = accounts.filter((a) => a.kind !== "card")
  const today = postedActivity(money, todayEntries)
  return money.map((a) => {
    const t = today.get(a.id) ?? { inflowMinor: 0, outflowMinor: 0 }
    return {
      id: a.id,
      name: a.label,
      kind: a.kind as "bank" | "cash" | "other",
      currency: a.currency,
      archived: a.archived,
      startOfTodayMinor: accountBalance({
        ...a,
        kind: a.kind as "bank" | "cash" | "other",
        inflowMinor: addMinor(a.inflowMinor, -t.inflowMinor),
        outflowMinor: addMinor(a.outflowMinor, -t.outflowMinor),
      }),
    }
  })
}

/**
 * Recurring incomes with the income recorded from each today: entries posted from the rule,
 * or (entered by hand) to the same income source.
 */
export function homeIncomes(recurring: RecurringData, todayEntries: readonly TodayEntry[], today: IsoDate): SafeToSpendIncome[] {
  const received = todayEntries.filter((e) => e.type === "income" && !e.voided && e.occurredOn === today)
  return recurring.rules
    .filter((r) => r.type === "income")
    .map((r) => ({
      id: r.id,
      name: r.note ?? "Income",
      schedule: toSchedule(r),
      amountMinor: r.amountMinor,
      currency: r.currency,
      archived: r.archived,
      recordedToday: received
        .filter((e) => e.recurringRuleId === r.id || (e.recurringRuleId === null && r.categoryId !== null && e.categoryId === r.categoryId))
        .map((e) => ({ accountId: e.accountId, amountMinor: e.amountMinor })),
    }))
}

/**
 * Every bill still to pay through `until`, overdue ones included: unpaid occurrences of
 * recurring expenses, loan EMIs and interest, card bills, borrowing repayments and statutory
 * dues. Paid, skipped, covered and archived items are left out.
 *
 * Overdue (before `today`): every pending EMI, card bill, repayment and statutory due past its
 * date (the bell's list); for a recurring expense, the occurrence the Recurring page shows as
 * due (its latest date on or before today) when that is before today and not yet posted or
 * skipped. Earlier missed occurrences are not counted, as Recurring doesn't ask for them.
 */
export function homeBills({
  recurring,
  loans,
  context,
  today,
  until,
}: {
  recurring: RecurringData
  loans: LoansView
  context: TransactionsContext
  today: IsoDate
  until: IsoDate
}): HomeBill[] {
  const accounts = new Map(context.accounts.map((a) => [a.id, a]))
  const categories = new Map<string, LedgerCategory>(context.categories.map((c) => [c.id, c]))
  const nameOf = (id: string | null) => (id ? (accounts.get(id)?.label ?? null) : null)
  const dueBy = (date: IsoDate) => date <= until
  const bills: HomeBill[] = []

  for (const rule of recurring.rules) {
    if (rule.type !== "expense" || rule.archived) continue
    const p = recurring.progress.get(rule.id)
    // Occurrences are handled in order, so everything after the latest handled one is unpaid.
    const handled = [p?.lastPostedOn, p?.lastSkippedOn].filter((d): d is IsoDate => Boolean(d)).sort().at(-1) ?? null
    const category = rule.categoryId ? categories.get(rule.categoryId) : undefined
    const schedule = toSchedule(rule)
    const due = latestOccurrenceOnOrBefore(schedule, today)
    const overdue = due !== null && due < today ? [due] : []
    for (const date of [...overdue, ...occurrencesBetween(schedule, today, until)]) {
      if (handled !== null && date <= handled) continue
      bills.push({
        id: `${rule.id}:${date}`,
        kind: "bill",
        overdue: date < today,
        name: rule.note || category?.name || "Bill",
        dueDate: date,
        amountMinor: rule.amountMinor,
        currency: rule.currency,
        accountId: rule.accountId,
        accountName: nameOf(rule.accountId),
        icon: category?.icon ?? null,
      })
    }
  }

  for (const loan of loans.loans) {
    for (const item of loan.items) {
      if (item.status !== "pending" || item.notNeeded || item.sourceArchived || !dueBy(item.dueDate)) continue
      bills.push({
        id: item.id,
        kind: "emi",
        overdue: item.dueDate < today,
        name: item.kind === "loan_interest" ? `${loan.name} interest` : `${loan.name} EMI`,
        dueDate: item.dueDate,
        amountMinor: item.split?.totalMinor ?? item.amountMinor,
        currency: loan.loan.currency,
        accountId: item.plannedAccountId,
        accountName: nameOf(item.plannedAccountId),
        icon: null,
      })
    }
  }

  for (const card of loans.shortTerm?.cards ?? []) {
    const bill = card.pendingBill
    if (!bill || bill.covered || bill.status !== "pending" || bill.payDefaultMinor <= 0 || !dueBy(bill.dueDate)) continue
    bills.push({
      id: bill.id,
      kind: "card",
      overdue: bill.dueDate < today,
      name: `${card.name} bill`,
      dueDate: bill.dueDate,
      amountMinor: bill.payDefaultMinor,
      currency: card.card.currency,
      accountId: bill.plannedAccountId,
      accountName: nameOf(bill.plannedAccountId),
      icon: null,
    })
  }

  for (const b of loans.shortTerm?.borrowings ?? []) {
    for (const due of b.dues) {
      if (due.status !== "pending" || due.remainingMinor <= 0 || !dueBy(due.dueDate)) continue
      const accountId = due.plannedAccountId ?? due.payFromAccountId
      bills.push({
        id: due.id,
        kind: "borrowing",
        overdue: due.dueDate < today,
        name: `Repay ${b.name}`,
        dueDate: due.dueDate,
        amountMinor: due.remainingMinor,
        currency: b.borrowing.currency,
        accountId,
        accountName: nameOf(accountId),
        icon: null,
      })
    }
  }

  for (const d of loans.statutory?.dues ?? []) {
    const item = d.item
    if (item.status !== "pending" || item.sourceArchived || d.leftMinor <= 0 || !dueBy(item.dueDate)) continue
    const accountId = item.plannedAccountId ?? item.payFromAccountId
    bills.push({
      id: item.id,
      kind: "statutory",
      overdue: item.dueDate < today,
      name: d.name,
      dueDate: item.dueDate,
      amountMinor: d.leftMinor,
      currency: d.due.currency,
      accountId,
      accountName: nameOf(accountId),
      icon: null,
    })
  }

  return bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
}

/** Goals' monthly saving (the Goals page's plan). Dated contributions aren't recorded yet, so none are passed. */
export function homeGoals(goals: GoalsView): SafeToSpendGoal[] {
  return goals.active
    .filter((g) => g.plan.monthlyMinor > 0)
    .map((g) => ({ id: g.goal.id, name: g.goal.name, monthlySavingMinor: g.plan.monthlyMinor, currency: g.goal.currency, contributions: [] }))
}

export function buildHome(input: HomeInput): HomeData {
  const { context, recurring, loans, goals, todayEntries, now } = input
  const { currency, timeZone } = context
  // The profile's date now (the same one safeToSpend uses), not the device's.
  const today = localDateTime(now, timeZone).date

  const incomes = homeIncomes(recurring, todayEntries, today)
  const next = nextIncomeDate(
    incomes.filter((i) => !i.archived && i.currency === currency),
    today,
  )
  const upcomingEnd = addDays(today, UPCOMING_DAYS)
  const candidates = [upcomingEnd, monthRange(today).end, next ? addDays(next, -1) : today].sort()
  const until = candidates.at(-1) ?? upcomingEnd
  const bills = homeBills({ recurring, loans, context, today, until })

  const spentTodayMinor = everydaySpendingMinor(todayEntries, { start: today, end: today }, currency)
  const safe = safeToSpend({
    now,
    timeZone,
    currency,
    accounts: startOfTodayAccounts(context.accounts, todayEntries),
    incomes,
    bills,
    goals: homeGoals(goals),
    spentTodayMinor,
  })

  // A limit saved in another currency is not used (the profile currency changed since).
  const rule = input.spendLimit && input.spendLimit.currency === currency ? input.spendLimit : null
  const limitToday = rule ? spendLimitToday(rule, [...input.earlierEntries, ...todayEntries], today, currency) : null
  const limit: HomeSpendLimit | null =
    rule && limitToday
      ? { ...rule, today: limitToday, exceedsMoneyAfterBills: limitExceedsMoneyAfterBills(limitToday.dailyMinor, safe.days, safe.availableMinor) }
      : null

  const upcoming = bills.filter((b) => b.dueDate <= upcomingEnd)

  const budgets = new Map(goals.budgets.map((b) => [b.category.id, b]))
  const categories: HomeCategory[] = []
  for (const [id, spentMinor] of input.spending) {
    if (spentMinor <= 0) continue
    const c = context.categories.find((x) => x.id === id)
    const budget = budgets.get(id)
    categories.push({ id, name: c?.name ?? budget?.category.name ?? "Other", icon: c?.icon ?? null, spentMinor, budget: budget?.status ?? null })
  }
  categories.sort((a, b) => b.spentMinor - a.spentMinor || a.name.localeCompare(b.name))

  const holdings = summarizeHoldings(
    context.accounts.filter((a) => a.kind !== "card").map((a) => ({ ...a, kind: a.kind as "bank" | "cash" | "other" })),
    currency,
  )
  const accounts: HomeAccount[] = holdings.rows
    .map((r) => ({ id: r.account.id, label: r.account.label, kind: r.account.kind as HomeAccount["kind"], currency: r.account.currency, balanceMinor: r.balanceMinor, inTotal: r.inTotal }))
    .sort((a, b) => Number(b.inTotal) - Number(a.inTotal) || b.balanceMinor - a.balanceMinor || a.label.localeCompare(b.label))

  return {
    name: input.name,
    today,
    timeZone,
    currency,
    isNew: context.accounts.length === 0 && !context.hasEntries,
    safe,
    spentTodayMinor,
    limit,
    comingUp: upcoming.slice(0, HOME_COMING_UP_LIMIT),
    comingUpMore: Math.max(0, upcoming.length - HOME_COMING_UP_LIMIT),
    where: { spentMinor: addMinor(...categories.map((c) => c.spentMinor)), categories: categories.slice(0, HOME_CATEGORY_LIMIT) },
    money: { totalMinor: holdings.totalAvailableMinor, accounts },
    reminders: bellReminders(loans),
  }
}
