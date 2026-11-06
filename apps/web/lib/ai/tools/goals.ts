import { z } from "zod"
import { type GoalItem, type GoalsView, type LoansView, buildGoalsView, buildLoansView, loadCashFlow, loadGoalsData, loadLoansData } from "@fin-creador/api"
import {
  type GoalProjection,
  type IsoDate,
  NO_DATE_ASSUMED_MONTHS,
  PROJECTION_HORIZON_MONTHS,
  PROJECTION_MEASURED_MONTHS,
  type ProjectionClaim,
  addDays,
  addMinor,
  formatMoney,
  goalProjection,
  monthStart,
} from "@fin-creador/domain"
import { type Figure, type FinanceTool, type GoalCheck, type ToolContext, ToolError } from "./types"

// goal_projection (Sprint 10.4): can a goal be reached at the current rate, by when, and what
// would have to change. The verdict and every figure come from goalProjection in
// packages/domain (rules there); the model only puts them into words. Claims on the same
// money, all in the profile currency:
//   * loans, card EMIs and borrowing: each pending instalment in its month; only its principal
//     when that loan or borrowing was paid in the months measured (the interest is then already
//     in spending), the whole instalment otherwise;
//   * statutory dues: what is left unpaid, in the month it falls due;
//   * other active goals: their monthly saving (savingPlan) until their target month;
//   * card bills: not taken off, as card purchases are already spending when made.

const goalInput = z
  .object({ goal: z.string().trim().min(1).max(80).optional().describe("The goal's name, in the person's own words. Never a goal they didn't name; leave out when they named none.") })
  .strict()
type GoalInput = z.infer<typeof goalInput>

export const VERDICT_WORDS = { yes: "Yes.", no: "No.", too_early: "Too early to say." } as const

export const YEARS = PROJECTION_HORIZON_MONTHS / 12

export const monthName = (date: IsoDate) => new Date(`${date}T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })

/** The goal asked for: same name (any case), else the one name containing it (or contained in it). Never a goal that wasn't named. */
export function pickGoal(
  active: readonly GoalItem[],
  name: string | undefined,
): { kind: "one"; item: GoalItem } | { kind: "unnamed" | "none" } | { kind: "several"; items: GoalItem[] } {
  if (name === undefined) return { kind: "unnamed" }
  const wanted = name.trim().toLocaleLowerCase()
  const exact = active.filter((g) => g.goal.name.trim().toLocaleLowerCase() === wanted)
  if (exact.length === 1) return { kind: "one", item: exact[0]! }
  const partial = active.filter((g) => {
    const n = g.goal.name.trim().toLocaleLowerCase()
    return n.includes(wanted) || wanted.includes(n)
  })
  if (partial.length === 1) return { kind: "one", item: partial[0]! }
  return partial.length === 0 ? { kind: "none" } : { kind: "several", items: partial }
}

const nameList = (names: readonly string[], last = "and") => (names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} ${last} ${names.at(-1)}`)

/** What Roma asks, built here and shown as is, when the goal asked for isn't clear (10.5). */
export function goalQuestion(picked: { kind: "unnamed" | "none" | "several"; items?: readonly GoalItem[] }, asked: string | undefined, active: readonly GoalItem[]): string {
  const all = active.map((g) => g.goal.name)
  const yours = `Your ${all.length === 1 ? "goal is" : "goals are"} ${nameList(all)}.`
  if (picked.kind === "several") return `Which goal do you mean: ${nameList(picked.items!.map((g) => g.goal.name), "or")}?`
  if (picked.kind === "none") {
    return `You have no goal called “${asked}”. ${yours} For a new trip, ask about it with where you want to go, domestic or international, the month, how many nights and how many people.`
  }
  return `Which goal do you mean? ${yours}`
}

export type Claims = { loans: ProjectionClaim[]; dues: ProjectionClaim[]; unscheduledBorrowing: boolean }

/** What loans, card EMIs, borrowing and statutory dues will take, per pending instalment. */
export function liabilityClaims(view: LoansView, currency: string, windowStart: IsoDate): Claims {
  const loans: ProjectionClaim[] = []
  for (const loan of view.loans) {
    if (loan.loan.currency !== currency || loan.badge === "closed") continue
    const paidRecently = loan.items.some((i) => i.payment !== null && i.payment.paidOn >= windowStart)
    for (const item of loan.items) {
      if (item.status !== "pending" || item.notNeeded) continue
      loans.push({ date: item.dueDate, amountMinor: paidRecently ? (item.principalMinor ?? item.amountMinor) : item.amountMinor })
    }
  }
  let unscheduledBorrowing = false
  for (const b of view.shortTerm?.borrowings ?? []) {
    if (b.borrowing.currency !== currency || b.owedMinor <= 0) continue
    if (b.dues.length === 0) unscheduledBorrowing = true
    const paidRecently = b.payments.some((p) => p.paidOn >= windowStart)
    for (const due of b.dues) {
      if (due.status !== "pending" || due.remainingMinor <= 0) continue
      loans.push({ date: due.dueDate, amountMinor: paidRecently ? due.remainingPrincipalMinor : due.remainingMinor })
    }
  }
  const dues = (view.statutory?.dues ?? [])
    .filter((d) => d.due.currency === currency && d.leftMinor > 0)
    .map((d) => ({ date: d.item.dueDate, amountMinor: d.leftMinor }))
  return { loans, dues, unscheduledBorrowing }
}

const dueBy = (claims: readonly ProjectionClaim[], next: IsoDate) => addMinor(...claims.filter((c) => c.date < next).map((c) => c.amountMinor))

/** What every projection reads (goal_projection, trip_check): goals, the months measured and the claims on the same money. */
export type ProjectionBasis = {
  goals: GoalsView
  cash: CashFlow
  complete: CashFlow["report"]["rows"]
  claims: Claims
  /** First day of the first month measured, and the last day of the last complete one. */
  windowStart: IsoDate
  lastComplete: IsoDate
}

type CashFlow = Extract<Awaited<ReturnType<typeof loadCashFlow>>, { ok: true }>["data"]

export async function loadProjectionBasis(ctx: ToolContext): Promise<ProjectionBasis> {
  const { today, currency } = ctx
  const windowStart = monthStart(today, -PROJECTION_MEASURED_MONTHS)
  const months = Array.from({ length: PROJECTION_MEASURED_MONTHS + 1 }, (_, i) => monthStart(today, i - PROJECTION_MEASURED_MONTHS))
  const [goals, cash, loans] = await Promise.all([loadGoalsData(ctx.supabase), loadCashFlow(ctx.supabase, months), loadLoansData(ctx.supabase)])
  if (!goals.ok) throw new ToolError("The goals couldn't be loaded.")
  if (!cash.ok) throw new ToolError("The income and spending figures couldn't be loaded.")
  if (!loans.ok) throw new ToolError("The loans and dues couldn't be loaded.")
  return {
    goals: buildGoalsView(goals.data),
    cash: cash.data,
    complete: cash.data.report.rows.filter((r) => !r.soFar),
    claims: liabilityClaims(buildLoansView(loans.data), currency, windowStart),
    windowStart,
    lastComplete: addDays(monthStart(today), -1),
  }
}

/** Every goal name the person has, active and archived. */
export const allGoalNames = (basis: ProjectionBasis) => [...basis.goals.active, ...basis.goals.archived].map((g) => g.goal.name)

/** Active goals in the currency still being saved for, except `exceptId`. */
export const otherGoals = (active: readonly GoalItem[], currency: string, exceptId: string | null) =>
  active.filter((g) => g.goal.id !== exceptId && g.goal.currency === currency && g.plan.basis !== "reached")

/** This month's claims, and the net recorded so far (shown when there are too few months to project). */
export function basisFigures(basis: ProjectionBasis, today: IsoDate) {
  const nextMonth = monthStart(today, 1)
  const tracked = basis.cash.report.rows.filter((r) => r.incomeMinor !== 0 || r.expenseMinor !== 0)
  return {
    loansNow: dueBy(basis.claims.loans, nextMonth),
    duesNow: dueBy(basis.claims.dues, nextMonth),
    netSoFar: addMinor(...tracked.map((r) => r.netMinor)),
    firstTracked: tracked[0]?.range.start ?? null,
  }
}

export const goalProjectionTool: FinanceTool<GoalInput> = {
  name: "goal_projection",
  description:
    "Checks whether one of the person's goals (planned expenses) can be reached at their current rate: the verdict, when it would be reached, what would have to change, the figures it used and its assumptions. Takes loans, card EMIs, borrowing, statutory dues and other goals into account. Use it for any question about whether a goal is achievable or when it will be reached.",
  input: goalInput,
  async run(ctx, input) {
    const { today, currency } = ctx
    const basis = await loadProjectionBasis(ctx)
    const { cash, claims, windowStart, lastComplete } = basis

    const active = basis.goals.active
    if (active.length === 0) throw new ToolError("There are no active goals to check.")
    const picked = pickGoal(active, input.goal)
    if (picked.kind !== "one") {
      return {
        data: { goals: active.map((g) => g.goal.name), note: "The app asks the person which goal they mean. Reply in one short sentence." },
        figures: [],
        needs: { tool: "goal_projection", missing: [picked.kind === "none" ? "no_such_goal" : "goal"], question: goalQuestion(picked, input.goal, active) },
      }
    }
    const { item } = picked
    const { goal } = item
    if (goal.currency !== currency) throw new ToolError(`${goal.name} is saved in ${goal.currency}; goals are checked in ${currency} only.`)

    const others = otherGoals(active, currency, goal.id)
    const projection = goalProjection({
      today,
      targetMinor: goal.targetMinor,
      savedMinor: goal.savedMinor,
      targetDate: goal.targetDate,
      months: basis.complete,
      claims: [...claims.loans, ...claims.dues],
      otherGoals: others.map((g) => g.plan),
    })

    const money = (minor: number) => formatMoney(minor, { currency })
    const { loansNow, duesNow, netSoFar, firstTracked } = basisFigures(basis, today)
    const noDateInvolved = goal.targetDate === null || others.some((g) => g.plan.basis === "assumed_months")
    const { plan } = projection
    const projected = projection.medianNetMinor !== null

    const figures: Figure[] = [
      { label: `${goal.name}: target`, kind: "money", minor: goal.targetMinor, currency },
      { label: `${goal.name}: saved`, kind: "money", minor: goal.savedMinor, currency },
      { label: `${goal.name}: still needed`, kind: "money", minor: plan.remainingMinor, currency },
    ]
    if (plan.basis === "target_date" || plan.basis === "assumed_months") {
      figures.push({ label: `${goal.name}: needed a month`, kind: "money", minor: plan.monthlyMinor, currency })
    }
    if (plan.basis !== "reached") {
      figures.push({ label: "Complete months looked at", kind: "count", value: PROJECTION_MEASURED_MONTHS })
      figures.push({ label: "Months with records", kind: "count", value: projection.monthsMeasured })
      if (projected) {
        figures.push({ label: "Median monthly net (income minus spending)", kind: "money", minor: projection.medianNetMinor!, currency })
        figures.push({ label: "Loan, card EMI and borrowing payments this month", kind: "money", minor: loansNow, currency })
        figures.push({ label: "Unpaid statutory dues this month", hideWhenZero: true, kind: "money", minor: duesNow, currency })
        for (const g of others) {
          figures.push({ label: `Assuming you keep saving for your other goals: ${g.goal.name}, a month`, kind: "money", minor: g.plan.monthlyMinor, currency })
        }
        figures.push({ label: "Free for this goal this month", kind: "money", minor: projection.freeThisMonthMinor!, currency })
      } else {
        figures.push({ label: "Net recorded so far", kind: "money", minor: netSoFar, currency })
      }
      if (projection.extraMonthlyMinor !== null) figures.push({ label: "Save more a month", kind: "money", minor: projection.extraMonthlyMinor, currency })
      if (projected && projection.reachMonth === null) figures.push({ label: "Projected at most, years", kind: "count", value: YEARS })
      if (noDateInvolved) figures.push({ label: "Months assumed for a goal with no date", kind: "count", value: NO_DATE_ASSUMED_MONTHS })
    }
    if (item.figures?.loan) {
      figures.push({ label: `${goal.name}: loan EMI after buying (not counted here)`, kind: "money", minor: item.figures.loan.emiMinor, currency })
    }

    const assumptions = buildAssumptions({
      ctx,
      projection,
      others,
      claims,
      otherCurrencies: cash.otherCurrencies,
      windowStart,
      lastComplete,
      noDateInvolved,
      hasLoan: !!item.figures?.loan,
    })
    const check: GoalCheck = {
      goal: goal.name,
      verdict: VERDICT_WORDS[projection.verdict],
      summary: verdictSummary(goal, projection, money, { netSoFar, firstTracked }),
      assumptions,
    }

    const dates = [
      windowStart,
      lastComplete,
      ...(firstTracked ? [firstTracked] : []),
      ...(goal.targetDate ? [goal.targetDate] : []),
      ...(projection.reachMonth ? [projection.reachMonth] : []),
    ]
    return {
      data: {
        goal: goal.name,
        verdict: check.verdict,
        verdict_summary: check.summary,
        target: money(goal.targetMinor),
        saved: money(goal.savedMinor),
        still_needed: money(plan.remainingMinor),
        target_month: goal.targetDate ? monthName(goal.targetDate) : null,
        target_month_passed: plan.basis === "past_due",
        needed_a_month: plan.basis === "target_date" || plan.basis === "assumed_months" ? money(plan.monthlyMinor) : null,
        months_with_records: projection.monthsMeasured,
        thin_estimate: projection.thin,
        median_monthly_net: projected ? money(projection.medianNetMinor!) : null,
        loan_payments_this_month: projected ? money(loansNow) : null,
        statutory_dues_this_month: projected ? money(duesNow) : null,
        other_goals_a_month: projected ? others.map((g) => ({ goal: g.goal.name, a_month: money(g.plan.monthlyMinor) })) : [],
        free_this_month: projected ? money(projection.freeThisMonthMinor!) : null,
        reached_in: projection.reachMonth ? monthName(projection.reachMonth) : null,
        save_more_a_month: projection.extraMonthlyMinor === null ? null : money(projection.extraMonthlyMinor),
        net_so_far: projected ? null : money(netSoFar),
        assumptions,
        note: `Start the answer with "${check.verdict}" exactly, then the figures, then what would have to change. verdict_summary says it all in order.`,
      },
      figures,
      period: { start: windowStart, end: lastComplete },
      dates,
      check,
      subject: { checked: goal.name, goals: allGoalNames(basis) },
    }
  },
}

function verdictSummary(
  goal: Pick<GoalItem["goal"], "name" | "targetDate" | "targetMinor" | "savedMinor">,
  p: GoalProjection,
  money: (minor: number) => string,
  so: { netSoFar: number; firstTracked: IsoDate | null },
): string {
  const { name, targetDate } = goal
  const { plan } = p
  const word = VERDICT_WORDS[p.verdict]
  const thin = p.thin ? ` This is based on only ${p.monthsMeasured} months of records, so the estimate is thin.` : ""
  const reached = p.reachMonth ? `in ${monthName(p.reachMonth)}` : `not within ${YEARS} years`
  const free = p.freeThisMonthMinor === null ? "" : ` Free for it this month: ${money(p.freeThisMonthMinor)}.`

  if (plan.basis === "reached") return `${word} ${name} is saved: ${money(goal.savedMinor)} of ${money(goal.targetMinor)}.`
  if (plan.basis === "past_due") {
    const head = `${word} The target date for ${name} (${monthName(targetDate!)}) has passed. ${money(plan.remainingMinor)} is still needed now.`
    return p.medianNetMinor === null
      ? `${head} There are only ${p.monthsMeasured} complete months of records, too few to say when it would be reached.`
      : `${head} At your current rate it would be reached ${reached}.${free}${thin}`
  }
  if (p.verdict === "too_early") {
    const since = so.firstTracked ? ` since ${so.firstTracked}` : ""
    return `${word} There are only ${p.monthsMeasured} complete months of records, too few to project from. ${name} needs ${money(plan.monthlyMinor)} a month. Your net${since}: ${money(so.netSoFar)}.`
  }
  if (plan.basis === "assumed_months") {
    return p.verdict === "yes"
      ? `${word} At your current rate ${name} would be reached ${reached}. It has no target date.${free}${thin}`
      : `${word} At your current rate ${name} would not be reached within ${YEARS} years.${free} To reach it within ${YEARS} years, save ${money(p.extraMonthlyMinor!)} more a month.${thin}`
  }
  const target = monthName(targetDate!)
  if (p.verdict === "yes") return `${word} At your current rate ${name} would be reached ${reached}, by the target of ${target}.${free}${thin}`
  const move = p.reachMonth ? `, or move the target to ${monthName(p.reachMonth)}` : ""
  return `${word} At your current rate ${name} would be reached ${reached}, after the target of ${target}.${free} To make it by ${target}, save ${money(p.extraMonthlyMinor!)} more a month${move}.${thin}`
}

export function buildAssumptions(a: {
  ctx: ToolContext
  projection: GoalProjection
  others: readonly GoalItem[]
  claims: Claims
  otherCurrencies: readonly string[]
  windowStart: IsoDate
  lastComplete: IsoDate
  noDateInvolved: boolean
  hasLoan: boolean
}): string[] {
  if (a.projection.plan.basis === "reached") return []
  const { currency } = a.ctx
  const list = [
    `Your rate is the median of your monthly net (income minus spending) over the complete months from ${a.windowStart} to ${a.lastComplete} that have records. This month isn't over, so it is left out. A month with no records isn't counted as zero.`,
    `Only ${currency} entries are counted; entries in other currencies are ignored, not added${a.otherCurrencies.length > 0 ? ` (you have some in ${a.otherCurrencies.join(", ")})` : ""}.`,
  ]
  if (a.projection.medianNetMinor === null) {
    list.push("At least 3 complete months with records are needed before Roma projects anything.")
    return list
  }
  if (a.projection.thin) list.push(`Only ${a.projection.monthsMeasured} months have records, so the estimate is thin.`)
  list.push(
    "Loan, card EMI and borrowing instalments are taken off in the month they fall due: only the principal for a loan you paid in the months measured (its interest is already in your spending), the whole instalment otherwise.",
    "Card bills are not taken off again: card purchases already count as spending when you make them.",
    "Unpaid statutory dues are taken off in the month they fall due. A due paid within the months measured is already inside the median, so this figure is deliberately conservative.",
  )
  if (a.claims.unscheduledBorrowing) list.push("Money borrowed without a return date is not taken off.")
  if (a.others.length > 0) {
    list.push(
      `Assuming you keep saving for your other goals (${a.others.map((g) => g.goal.name).join(", ")}) at the monthly amount each needs until its target month.`,
    )
  }
  if (a.noDateInvolved) list.push(`A goal with no target date is spread over ${NO_DATE_ASSUMED_MONTHS} months, as on the Goals page.`)
  list.push(
    `Projected at most ${YEARS} years ahead, or to the target date when that is later. Free money left after reaching a goal isn't carried anywhere else.`,
  )
  if (a.hasLoan) list.push("The loan EMI after buying starts once the goal is reached and isn't counted here.")
  return list
}
