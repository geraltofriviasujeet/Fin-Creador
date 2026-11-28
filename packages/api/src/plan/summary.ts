import { type BudgetStatus, type IsoDate, evenSpendShare } from "@fin-creador/domain"
import type { ShortTermView } from "../cards/view"
import type { BudgetItem, GoalItem, GoalsView } from "../goals/view"
import type { InvestmentsView } from "../investments/view"
import type { LoansView } from "../loans/view"
import type { StatutoryView } from "../statutory/view"
import type { RecurringItem, RecurringView } from "../recurring/view"

// The phone's Plan tab (Sprint 13c): one summary card per section, built from the same views
// the web pages build, so every figure is the web's. Each section loads on its own, so each has
// its own builder. Pure: nothing is fetched, no amount is converted between currencies, and
// totals come from the views (never re-added here).

export const PLAN_TOP_BUDGETS = 3
export const PLAN_TOP_GOALS = 3
export const PLAN_NEXT_DUES = 3
export const PLAN_BILL_CHIPS = 6

const LEVEL_ORDER: Record<BudgetStatus["level"], number> = { over: 0, warning: 1, ok: 2 }

/** Plain code-unit order (no Intl collation, so Hermes and the web agree). */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export type PlanBudgets = {
  currency: string
  /** First day of the budget month shown. */
  month: IsoDate
  /** All budgets in the profile currency together (the web's total); null when there are none. */
  total: BudgetStatus | null
  /** The even-spend mark, 0..1 (phone only for now). */
  evenSpend: number
  /** Over first, then nearly over, then the most used; budgets with a status only. */
  top: BudgetItem[]
  count: number
  overCount: number
  warningCount: number
  /** Budgets in another currency: "Set your budget again", no bar. */
  resetCount: number
}

export function planBudgets(view: Pick<GoalsView, "today" | "currency" | "budgets" | "total" | "budgetMonth">): PlanBudgets {
  const withStatus = view.budgets.filter((b): b is BudgetItem & { status: BudgetStatus } => b.status !== null)
  const top = [...withStatus]
    .sort(
      (a, b) =>
        LEVEL_ORDER[a.status.level] - LEVEL_ORDER[b.status.level] || b.status.usedBps - a.status.usedBps || byText(a.category.name, b.category.name),
    )
    .slice(0, PLAN_TOP_BUDGETS)
  return {
    currency: view.currency,
    month: view.budgetMonth.start,
    total: view.total,
    evenSpend: evenSpendShare(view.budgetMonth.start, view.today),
    top,
    count: view.budgets.length,
    overCount: withStatus.filter((b) => b.status.level === "over").length,
    warningCount: withStatus.filter((b) => b.status.level === "warning").length,
    resetCount: view.budgets.length - withStatus.length,
  }
}

export type PlanGoals = {
  /** In the Goals page's order (nearest target date first). */
  top: GoalItem[]
  count: number
  archivedCount: number
}

export function planGoals(view: Pick<GoalsView, "active" | "archived">): PlanGoals {
  return { top: view.active.slice(0, PLAN_TOP_GOALS), count: view.active.length, archivedCount: view.archived.length }
}

/** One thing to pay next on the Loans & dues card. */
export type PlanDue = {
  source: "loan" | "card" | "borrowing" | "statutory"
  /** The due item (what Pay records against). */
  dueItemId: string
  /** The loan, card, borrowing or statutory due it belongs to. */
  ownerId: string
  name: string
  label: string
  dueDate: IsoDate
  amountMinor: number
  currency: string
  overdue: boolean
  plannedOn: IsoDate | null
}

export type PlanLoans = {
  currency: string
  /** Soonest first; overdue ones lead. Pending only; nothing archived. */
  next: PlanDue[]
  overdueCount: number
  /** Loans other than card EMIs (those sit with the cards, as on the web). */
  loanCount: number
  cardCount: number
  borrowingCount: number
  statutoryCount: number
  longTermOutstandingMinor: number
  /** Cards, card EMIs and borrowing owed now; null when that part did not load. */
  shortTermOwedMinor: number | null
  /** Statutory dues still to pay; null when that part did not load. */
  statutoryDueMinor: number | null
  empty: boolean
}

type LoansInput = Pick<LoansView, "today" | "currency" | "loans" | "longTermOutstandingMinor"> & {
  shortTerm: Pick<ShortTermView, "cards" | "borrowings" | "cardEmis" | "totalOwedMinor"> | null
  statutory: Pick<StatutoryView, "dues" | "totalDueMinor"> | null
}

export function planLoans(view: LoansInput): PlanLoans {
  const { today } = view
  const dues: PlanDue[] = []
  const linkedToCard = new Set((view.shortTerm?.cards ?? []).flatMap((c) => c.linkedLoanIds))
  for (const l of view.loans) {
    const n = l.next
    // A card EMI linked to a card is paid with that card's bill ("EMIs included"): not twice.
    if (!n || n.status !== "pending" || n.notNeeded || n.sourceArchived || linkedToCard.has(l.loan.id)) continue
    dues.push({
      source: "loan", dueItemId: n.id, ownerId: l.loan.id, name: l.name, label: n.label, dueDate: n.dueDate,
      amountMinor: n.amountMinor, currency: l.loan.currency, overdue: n.dueDate < today, plannedOn: n.plannedOn,
    })
  }
  for (const c of view.shortTerm?.cards ?? []) {
    const b = c.pendingBill
    if (!b || b.covered || b.leftMinor <= 0) continue
    dues.push({
      source: "card", dueItemId: b.id, ownerId: c.card.id, name: c.name, label: "Card bill", dueDate: b.dueDate,
      amountMinor: b.leftMinor, currency: c.card.currency, overdue: b.dueDate < today, plannedOn: b.plannedOn,
    })
  }
  for (const b of view.shortTerm?.borrowings ?? []) {
    const d = b.due
    if (!d || d.status !== "pending" || d.remainingMinor <= 0) continue
    dues.push({
      source: "borrowing", dueItemId: d.id, ownerId: b.borrowing.id, name: b.name, label: d.seq === 0 ? "Return" : `Instalment ${d.seq}`,
      dueDate: d.dueDate, amountMinor: d.remainingMinor, currency: b.borrowing.currency, overdue: d.dueDate < today, plannedOn: d.plannedOn,
    })
  }
  for (const s of view.statutory?.dues ?? []) {
    if (s.item.status !== "pending" || s.leftMinor <= 0 || s.item.sourceArchived) continue
    dues.push({
      source: "statutory", dueItemId: s.item.id, ownerId: s.due.id, name: s.name, label: s.typeLabel, dueDate: s.item.dueDate,
      amountMinor: s.leftMinor, currency: s.due.currency, overdue: s.item.dueDate < today, plannedOn: s.item.plannedOn,
    })
  }
  dues.sort((a, b) => byText(a.dueDate, b.dueDate) || byText(a.name, b.name) || byText(a.dueItemId, b.dueItemId))
  const cardEmiIds = new Set((view.shortTerm?.cardEmis ?? []).map((l) => l.loan.id))
  const loanCount = view.loans.filter((l) => !cardEmiIds.has(l.loan.id)).length
  const cardCount = view.shortTerm?.cards.length ?? 0
  const borrowingCount = view.shortTerm?.borrowings.length ?? 0
  const statutoryCount = view.statutory?.dues.length ?? 0
  return {
    currency: view.currency,
    next: dues.slice(0, PLAN_NEXT_DUES),
    overdueCount: dues.filter((d) => d.overdue).length,
    loanCount,
    cardCount,
    borrowingCount,
    statutoryCount,
    longTermOutstandingMinor: view.longTermOutstandingMinor,
    shortTermOwedMinor: view.shortTerm ? view.shortTerm.totalOwedMinor : null,
    statutoryDueMinor: view.statutory ? view.statutory.totalDueMinor : null,
    empty: view.loans.length + cardCount + borrowingCount + statutoryCount === 0,
  }
}

export type PlanBills = {
  /** Due (overdue first, by date), then coming up: the Recurring page's own order. */
  chips: RecurringItem[]
  /** Items left off the chips, for "See all". */
  more: number
  dueCount: number
  attentionCount: number
}

export function planBills(view: Pick<RecurringView, "due" | "soon" | "attention">): PlanBills {
  const all = [...view.due, ...view.soon]
  const chips = all.slice(0, PLAN_BILL_CHIPS)
  return { chips, more: all.length - chips.length, dueCount: view.due.length, attentionCount: view.attention.length }
}

export type PlanInvestments = Pick<InvestmentsView, "totals" | "categories" | "pricesAsOf"> & {
  holdingCount: number
  depositCount: number
  empty: boolean
}

export function planInvestments(view: Pick<InvestmentsView, "groups" | "deposits" | "totals" | "categories" | "pricesAsOf">): PlanInvestments {
  return {
    totals: view.totals,
    categories: view.categories,
    pricesAsOf: view.pricesAsOf,
    holdingCount: view.groups.length,
    depositCount: view.deposits.length,
    empty: view.groups.length === 0 && view.deposits.length === 0,
  }
}
