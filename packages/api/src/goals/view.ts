import {
  type BudgetRow,
  type BudgetStatus,
  type DateRange,
  type GoalDetails,
  type GoalFigures,
  type IsoDate,
  type SavingPlan,
  addMinor,
  budgetStatus,
  budgetsForMonth,
  goalFigures,
  monthRange,
  savingPlan,
} from "@fin-creador/domain"
import { parseGoalDetails } from "@fin-creador/schemas"

// The Goals page and the Overview cards (Sprint 6), built from the loaded rows with the
// shared domain rules. Pure, so web and mobile show the same figures.

export type GoalRecord = {
  id: string
  type: string
  name: string
  targetMinor: number
  savedMinor: number
  currency: string
  targetDate: IsoDate | null
  details: unknown
  archivedAt: string | null
  createdAt: string
}

export type GoalItem = {
  goal: GoalRecord
  /** Null when the stored answers can't be read (shown, but without derived figures). */
  answers: GoalDetails | null
  figures: GoalFigures | null
  plan: SavingPlan
}

export type BudgetCategory = { id: string; name: string; icon: string | null; archived: boolean }

export type BudgetItem = {
  category: BudgetCategory
  budget: BudgetRow
  /** This month's spending in the profile currency. */
  spentMinor: number
  /** Null when the budget is in another currency: "Set your budget again", no percentage. */
  status: BudgetStatus | null
}

export type GoalsView = {
  today: IsoDate
  currency: string
  month: DateRange
  active: GoalItem[]
  archived: GoalItem[]
  budgets: BudgetItem[]
  /** Active expense categories without a budget this month. */
  unbudgeted: BudgetCategory[]
  /** All budgets this month in the profile currency together; null when there are none. */
  total: BudgetStatus | null
}

export type GoalsData = {
  today: IsoDate
  currency: string
  goals: GoalRecord[]
  budgetRows: BudgetRow[]
  categories: BudgetCategory[]
  /** Expense per category this month, profile currency only. */
  spending: ReadonlyMap<string, number>
}

function goalItem(goal: GoalRecord, today: IsoDate): GoalItem {
  const answers = parseGoalDetails(goal.type, goal.details)
  let figures: GoalFigures | null = null
  if (answers) {
    try {
      figures = goalFigures(answers)
    } catch {
      figures = null
    }
  }
  return {
    goal,
    answers,
    figures,
    plan: savingPlan({ targetMinor: goal.targetMinor, savedMinor: goal.savedMinor, targetDate: goal.targetDate, today }),
  }
}

/** Soonest target date first; goals without a date after them; then oldest first. */
function byTargetDate(a: GoalItem, b: GoalItem): number {
  const da = a.goal.targetDate ?? "9999-12-31"
  const db = b.goal.targetDate ?? "9999-12-31"
  return da === db ? a.goal.createdAt.localeCompare(b.goal.createdAt) : da < db ? -1 : 1
}

export function buildGoalsView(data: GoalsData): GoalsView {
  const { today, currency } = data
  const items = data.goals.map((g) => goalItem(g, today))
  const active = items.filter((i) => !i.goal.archivedAt).sort(byTargetDate)
  const archived = items.filter((i) => i.goal.archivedAt).sort(byTargetDate)

  const current = budgetsForMonth(data.budgetRows, today)
  const categories = new Map(data.categories.map((c) => [c.id, c]))
  const budgets: BudgetItem[] = []
  for (const [categoryId, budget] of current) {
    const category = categories.get(categoryId)
    if (!category) continue
    const spentMinor = data.spending.get(categoryId) ?? 0
    const status = budget.currency === currency ? budgetStatus(spentMinor, budget.amountMinor) : null
    budgets.push({ category, budget, spentMinor, status })
  }
  budgets.sort((a, b) => a.category.name.localeCompare(b.category.name))

  const comparable = budgets.filter((b) => b.status !== null)
  const total =
    comparable.length > 0
      ? budgetStatus(addMinor(...comparable.map((b) => b.spentMinor)), addMinor(...comparable.map((b) => b.budget.amountMinor)))
      : null

  const budgeted = new Set(budgets.map((b) => b.category.id))
  const unbudgeted = data.categories.filter((c) => !c.archived && !budgeted.has(c.id)).sort((a, b) => a.name.localeCompare(b.name))

  return { today, currency, month: monthRange(today), active, archived, budgets, unbudgeted, total }
}
