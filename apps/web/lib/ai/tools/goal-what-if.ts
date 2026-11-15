import { z } from "zod"
import {
  type GoalProjection,
  type GoalWhatIf,
  type IsoDate,
  NO_DATE_ASSUMED_MONTHS,
  currencyMinorDigits,
  formatMoney,
  goalWhatIf,
  monthStart,
  whatIfAmountsIn,
  whatIfMonthsIn,
} from "@fin-creador/domain"
import { YEARS, allGoalNames, buildAssumptions, goalQuestion, loadProjectionBasis, monthName, otherGoals, pickGoal } from "./goals"
import { type Figure, type FinanceTool, type GoalCheck, type ToolOutput, ToolError } from "./types"

// goal_what_if (Sprint 10.7a): one change to one named goal, worked out by goalWhatIf in
// packages/domain on the goal check's own projection (same months, claims and other goals).
// The amount or month is what the person typed in this question, read in code: the model may
// point at it (`amount`, `by`, as typed) but a value the person didn't type is never used, and
// one the code can't read gets a question built here. Everything shown is built here: the
// verdict line, the before/after comparison, the lines under it. Never a recommendation: no
// ranking of goals and no products; a shortfall is stated as a figure and nothing more.

export const WHAT_IF_CHANGES = ["save_more", "save_less", "cost_more", "cost_less", "by_month"] as const
type Change = (typeof WHAT_IF_CHANGES)[number]

const whatIfInput = z
  .object({
    goal: z.string().trim().min(1).max(80).optional().describe("The goal's name, in the person's own words. Never a goal they didn't name; leave out when they named none."),
    change: z
      .enum(WHAT_IF_CHANGES)
      .describe("save_more / save_less: an amount more or less saved a month; cost_more / cost_less: the goal costing an amount more or less; by_month: the amount a month needed to reach it by a month."),
    amount: z.string().trim().min(1).max(40).optional().describe("For save_* and cost_*: the amount exactly as the person typed it (\"5000\", \"5k\", \"2 lakh\"). Never one they didn't type."),
    by: z.string().trim().min(1).max(40).optional().describe("For by_month: the month exactly as the person typed it (\"Dec 2027\", \"next June\", \"in 18 months\", \"2 saal mein\")."),
  })
  .strict()
type WhatIfInput = z.infer<typeof whatIfInput>

/** Said once in every what-if answer and on its card. */
export const SAVINGS_ONLY = "Savings only: no investment returns, no interest and no inflation."
export const ONLY_THIS_GOAL = "Only this goal changes: your other goals, loan payments and dues are taken as they are today."

const MORE = /\b(?:more|extra|additional|increased?|higher|costlier|zyada|jyada|zada|adhik|mehe?nga|mehe?ngi)\b/i
const LESS = /\b(?:less|fewer|reduced?|lower|cheaper|decreased?|kam|sasta|sasti)\b/i

/** "more" or "less" when the person's words say only one of them. */
function directionSaid(text: string): "more" | "less" | null {
  const more = MORE.test(text)
  const less = LESS.test(text)
  return more === less ? null : more ? "more" : "less"
}

/** One value the person typed: the one the model pointed at (if it is among them), else the only one. */
function typed<T>(said: readonly T[], pointed: readonly T[] | null): T | null {
  if (pointed !== null) return pointed.length === 1 && said.includes(pointed[0]!) ? pointed[0]! : null
  return said.length === 1 ? said[0]! : null
}

const EXAMPLE_AMOUNTS = "for example 5000, 5k, 5 hazaar or 2 lakh"
const EXAMPLE_MONTHS = "for example Dec 2027, next June, in 18 months or 2 saal mein"

function needs(question: string, missing: string, goals: readonly string[]): ToolOutput {
  return {
    data: { goals, note: "The app asks the person. Reply in one short sentence." },
    figures: [],
    needs: { tool: "goal_what_if", missing: [missing], question },
  }
}

export const goalWhatIfTool: FinanceTool<WhatIfInput> = {
  name: "goal_what_if",
  description:
    "Works out a \"what if\" for one goal the person named, from their own records: saving an amount more or less a month (when it is reached), the amount a month needed to reach it by a month, or the goal costing an amount more or less. Savings only. Use it for any such question; pass the amount or month exactly as the person typed it.",
  input: whatIfInput,
  async run(ctx, input) {
    const { today, currency } = ctx
    const basis = await loadProjectionBasis(ctx)
    const { cash, claims, windowStart, lastComplete } = basis
    const active = basis.goals.active
    if (active.length === 0) throw new ToolError("There are no active goals to work this out for.")
    const picked = pickGoal(active, input.goal)
    if (picked.kind !== "one") return needs(goalQuestion(picked, input.goal, active), picked.kind === "none" ? "no_such_goal" : "goal", active.map((g) => g.goal.name))
    const { item } = picked
    const { goal } = item
    if (goal.currency !== currency) throw new ToolError(`${goal.name} is saved in ${goal.currency}; goals are worked out in ${currency} only.`)
    const names = active.map((g) => g.goal.name)
    const asked = ctx.asked ?? ""
    const { change } = input
    const money = (minor: number) => formatMoney(minor, { currency })

    // The change, from the person's own words only.
    let domainChange: Parameters<typeof goalWhatIf>[1]
    let deltaMinor = 0
    let month: IsoDate | null = null
    if (change === "by_month") {
      month = typed(whatIfMonthsIn(asked, today), input.by === undefined ? null : whatIfMonthsIn(input.by, today))
      if (month === null) return needs(`By which month do you want to reach ${goal.name}? Write it as, ${EXAMPLE_MONTHS}.`, "month", names)
      domainChange = { kind: "by_month", month }
    } else {
      const cost = change.startsWith("cost")
      const rupees = typed(whatIfAmountsIn(asked), input.amount === undefined ? null : whatIfAmountsIn(input.amount))
      if (rupees === null) {
        const what = cost ? `How much more or less would ${goal.name} cost?` : `How much more or less a month do you want to try for ${goal.name}?`
        return needs(`${what} Write the amount, ${EXAMPLE_AMOUNTS}.`, "amount", names)
      }
      const direction = change.endsWith("more") ? "more" : "less"
      const said = directionSaid(asked)
      if (said !== null && said !== direction) {
        return needs(`Do you mean ${money(rupees * 10 ** currencyMinorDigits(currency))} more or less${cost ? "" : " a month"} for ${goal.name}?`, "direction", names)
      }
      const minor = rupees * 10 ** currencyMinorDigits(currency)
      if (!Number.isSafeInteger(minor)) throw new ToolError("That amount is too large.")
      deltaMinor = direction === "more" ? minor : -minor
      domainChange = { kind: cost ? "cost" : "monthly", deltaMinor }
    }

    const others = otherGoals(active, currency, goal.id)
    const r = goalWhatIf(
      {
        today,
        targetMinor: goal.targetMinor,
        savedMinor: goal.savedMinor,
        targetDate: goal.targetDate,
        months: basis.complete,
        claims: [...claims.loans, ...claims.dues],
        otherGoals: others.map((g) => g.plan),
      },
      domainChange,
    )
    const shown = describeWhatIf(r, { name: goal.name, targetMinor: goal.targetMinor, savedMinor: goal.savedMinor, change, deltaMinor, month, today, money })
    const noDateInvolved = goal.targetDate === null || others.some((g) => g.plan.basis === "assumed_months")
    const assumptions = r.before
      ? buildAssumptions({ ctx, projection: r.before, others, claims, otherCurrencies: cash.otherCurrencies, windowStart, lastComplete, noDateInvolved, hasLoan: false })
      : []
    const check: GoalCheck = { kind: "what_if", goal: goal.name, verdict: shown.verdict, summary: shown.summary, assumptions, lines: shown.lines, ...(shown.comparison ? { comparison: shown.comparison } : {}) }

    const figures: Figure[] = [
      { label: `${goal.name}: target`, kind: "money", minor: goal.targetMinor, currency },
      { label: `${goal.name}: saved`, kind: "money", minor: goal.savedMinor, currency },
      ...shown.figures.map(([label, minor]): Figure => ({ label, kind: "money", minor, currency })),
    ]
    if (r.before && r.before.plan.basis !== "reached") figures.push({ label: "Months with records", kind: "count", value: r.before.monthsMeasured })
    const median = r.before?.medianNetMinor ?? null
    if (median !== null) figures.push({ label: "Median monthly net (income minus spending)", kind: "money", minor: median, currency })
    if (noDateInvolved && median !== null) figures.push({ label: "Months assumed for a goal with no date", kind: "count", value: NO_DATE_ASSUMED_MONTHS })
    if (shown.notWithinYears) figures.push({ label: "Projected at most, years", kind: "count", value: YEARS })

    const dates = [windowStart, lastComplete, monthStart(today), ...[goal.targetDate, r.before?.reachMonth, r.after?.reachMonth, month].filter((d): d is IsoDate => !!d)]
    return {
      data: {
        goal: goal.name,
        change,
        verdict: check.verdict,
        verdict_summary: check.summary,
        comparison: shown.comparison ?? null,
        lines: shown.lines,
        thin_estimate: r.before?.thin ?? false,
        assumptions,
        note: `Start the answer with "${check.verdict}" exactly; verdict_summary says it all in order. State the results as facts, with the amounts by their placeholders. Never advise: never say what the person should do, never recommend, suggest or rank goals, and never name a product or account. Say that it is savings only.`,
      },
      figures,
      period: { start: windowStart, end: lastComplete },
      dates,
      check,
      subject: { checked: goal.name, goals: allGoalNames(basis) },
    }
  },
}

type Shown = {
  verdict: string
  summary: string
  lines: string[]
  comparison?: NonNullable<GoalCheck["comparison"]>
  figures: [string, number][]
  notWithinYears: boolean
}

/** Every word and row shown for a what-if, built from goalWhatIf's result. */
export function describeWhatIf(
  r: GoalWhatIf,
  a: { name: string; targetMinor: number; savedMinor: number; change: Change; deltaMinor: number; month: IsoDate | null; today: IsoDate; money: (minor: number) => string },
): Shown {
  const { name, money } = a
  /** The goal's cost after the change (only a cost change changes it). */
  const costAfter = a.change === "cost_more" || a.change === "cost_less" ? a.targetMinor + a.deltaMinor : a.targetMinor
  const size = money(Math.abs(a.deltaMinor))
  const lines = [SAVINGS_ONLY, ONLY_THIS_GOAL]
  const done = (verdict: string, text: string, figures: [string, number][] = []): Shown => ({ verdict, summary: `${verdict} ${text}`.trim(), lines, figures, notWithinYears: false })
  const { before, after } = r
  const thin = before?.thin ? ` This is based on only ${before.monthsMeasured} months of records, so the estimate is thin.` : ""

  switch (r.outcome) {
    case "no_target":
      return done("No target amount.", `${name} has no target amount, so there is nothing to work out. A target can be set on the Goals page.`)
    case "past_month":
      return done("That month has passed.", `${monthName(a.month!)} is before this month. Name a month from ${monthName(monthStart(a.today))} on.`)
    case "no_cost_left":
      return done("Nothing left to save.", `At ${size} less, ${name} would cost nothing or less, so there is nothing left to work out.`, [["Change in cost", Math.abs(a.deltaMinor)]])
    case "reached":
      return done("Already reached.", `${name} is saved: ${money(a.savedMinor)} of ${money(costAfter)}${costAfter === a.targetMinor ? "" : `, at ${size} ${a.deltaMinor > 0 ? "more" : "less"}`}.`)
    case "too_early":
      return done("Too early to say.", `There are only ${before!.monthsMeasured} complete months of records, too few to work this out from. At least 3 are needed.`)
  }

  const reach = (p: GoalProjection) => (p.plan.basis === "reached" ? "already saved" : p.reachMonth ? monthName(p.reachMonth) : `not within ${YEARS} years`)
  const was = before!
  if (was.thin) lines.push(`Only ${was.monthsMeasured} months have records, so the estimate is thin.`)
  const notWithinYears = was.reachMonth === null || after?.reachMonth === null

  if (a.change === "by_month") {
    const by = r.byMonth!
    const target = monthName(by.month)
    const figures: [string, number][] = [
      ["Still needed", was.plan.remainingMinor],
      [`Needed a month to reach it by ${target}`, by.neededMonthlyMinor],
      [`Free from this month to ${target}`, by.availableMinor],
    ]
    const head = `To reach ${name} by ${target}: ${money(by.neededMonthlyMinor)} a month over ${by.months} ${by.months === 1 ? "month" : "months"}. Your records show ${money(by.availableMinor)} free from this month to ${target}`
    if (by.extraMonthlyMinor === 0) {
      return { ...done("Covered by what is free.", `${head}, enough to reach it in ${reach(after!)}.${thin}`, figures), notWithinYears }
    }
    figures.push(["Short a month", by.extraMonthlyMinor])
    lines.push(`Short by ${money(by.extraMonthlyMinor)} a month: your records show ${money(by.availableMinor)} free from this month to ${target}, and ${money(was.plan.remainingMinor)} is still needed.`)
    return {
      ...done("More than is free.", `${head}: short by ${money(by.extraMonthlyMinor)} a month.${thin}`, figures),
      notWithinYears,
      comparison: { before: "As it is", after: `${money(by.extraMonthlyMinor)} more a month`, rows: [savingRow(was, after!, money), { label: "Reached in", before: reach(was), after: reach(after!) }] },
    }
  }

  const now = after!
  const verdict = r.outcome === "projected" ? `Reached in ${monthName(now.reachMonth!)}.` : "Not reached."
  if (a.change === "save_more" || a.change === "save_less") {
    const more = a.deltaMinor > 0
    const figures: [string, number][] = [
      ["Free for this goal this month", was.freeThisMonthMinor!],
      [more ? "Saved more a month" : "Saved less a month", Math.abs(a.deltaMinor)],
      ["For this goal this month, with the change", now.freeThisMonthMinor!],
    ]
    if (more) {
      const free = was.freeThisMonthMinor!
      lines.push(`${free > 0 ? `Your records show ${money(free)} free a month today` : "Your records show nothing free a month today"}; this assumes you find the extra ${size}.`)
    }
    const nothingLeft = !more && now.freeThisMonthMinor! <= 0
    const text =
      r.outcome === "projected"
        ? `Saving ${size} ${more ? "more" : "less"} a month (${money(now.freeThisMonthMinor!)} for it this month), ${name} would be reached in ${monthName(now.reachMonth!)}, instead of ${reach(was)}.`
        : nothingLeft
          ? `Saving ${size} less a month leaves nothing for ${name} (${money(now.freeThisMonthMinor!)} this month), so it is not reached.`
          : `Saving ${size} ${more ? "more" : "less"} a month, ${name} would not be reached within ${YEARS} years.`
    return {
      verdict,
      summary: `${verdict} ${text}${thin}`,
      lines,
      figures,
      notWithinYears: notWithinYears && !nothingLeft,
      comparison: {
        before: "As it is",
        after: `${size} ${more ? "more" : "less"} a month`,
        rows: [savingRow(was, now, money), { label: "Reached in", before: reach(was), after: nothingLeft ? "not reached" : reach(now) }],
      },
    }
  }

  const more = a.deltaMinor > 0
  const figures: [string, number][] = [
    [more ? "Costs more" : "Costs less", Math.abs(a.deltaMinor)],
    [`${name}: target, with the change`, costAfter],
    ["Still needed, with the change", now.plan.remainingMinor],
  ]
  const cost = money(costAfter)
  const text =
    r.outcome === "projected"
      ? `If ${name} cost ${size} ${more ? "more" : "less"} (${cost} in all), it would be reached in ${monthName(now.reachMonth!)}, instead of ${reach(was)}.`
      : `If ${name} cost ${size} ${more ? "more" : "less"} (${cost} in all), it would not be reached within ${YEARS} years.`
  return {
    verdict,
    summary: `${verdict} ${text}${thin}`,
    lines,
    figures,
    notWithinYears,
    comparison: {
      before: "As it is",
      after: `Costing ${size} ${more ? "more" : "less"}`,
      rows: [
        { label: "Cost", before: money(a.targetMinor), after: cost },
        { label: "Still needed", before: money(was.plan.remainingMinor), after: money(now.plan.remainingMinor) },
        { label: "Reached in", before: reach(was), after: reach(now) },
      ],
    },
  }
}

const savingRow = (was: GoalProjection, now: GoalProjection, money: (minor: number) => string) => ({
  label: "For this goal this month",
  before: money(was.freeThisMonthMinor!),
  after: money(now.freeThisMonthMinor!),
})
