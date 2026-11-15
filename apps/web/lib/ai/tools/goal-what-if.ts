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
    const unit = 10 ** currencyMinorDigits(currency)
    const shown = describeWhatIf(r, { name: goal.name, targetMinor: goal.targetMinor, savedMinor: goal.savedMinor, change, deltaMinor, month, today, currency })
    const noDateInvolved = goal.targetDate === null || others.some((g) => g.plan.basis === "assumed_months")
    const assumptions = r.before
      ? buildAssumptions({ ctx, projection: r.before, others, claims, otherCurrencies: cash.otherCurrencies, windowStart, lastComplete, noDateInvolved, hasLoan: false })
      : []
    const check: GoalCheck = {
      kind: "what_if",
      goal: goal.name,
      verdict: shown.verdict,
      ...(shown.caveat ? { caveat: shown.caveat } : {}),
      summary: shown.summary,
      assumptions,
      lines: shown.lines,
      ...(shown.comparison ? { comparison: shown.comparison } : {}),
    }

    // Whole units only (10.7a): the figures are rounded as the card and summary round them.
    const figures: Figure[] = [
      { label: `${goal.name}: target`, kind: "money", minor: wholeMinor(goal.targetMinor, unit), currency },
      { label: `${goal.name}: saved`, kind: "money", minor: wholeMinor(goal.savedMinor, unit), currency },
      ...shown.figures.map(([label, minor]): Figure => ({ label, kind: "money", minor, currency })),
    ]
    if (r.before && r.before.plan.basis !== "reached") figures.push({ label: "Months with records", kind: "count", value: r.before.monthsMeasured })
    const median = r.before?.medianNetMinor ?? null
    if (median !== null) figures.push({ label: "Median monthly net (income minus spending)", kind: "money", minor: wholeMinor(median, unit), currency })
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
        note: `Start the answer with "${check.verdict}" exactly; verdict_summary says it all in order. State the results as facts, with the amounts by their placeholders. Never advise: never say what the person should do, never recommend, suggest or rank goals, and never name a product or account. At most two sentences: the card shows the figures and says it is savings only.`,
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
  /** The second line on the card, under the answer (10.7a). */
  caveat?: string
  summary: string
  lines: string[]
  comparison?: NonNullable<GoalCheck["comparison"]>
  /** Labels and amounts, already in whole units. */
  figures: [string, number][]
  notWithinYears: boolean
}

/** A minor amount in whole units (rupees): rounded half away from zero, or up (away from zero) for an amount needed. */
export function wholeMinor(minor: number, unit: number, up = false): number {
  const rest = minor % unit
  if (rest === 0) return minor
  const towardZero = minor - rest
  const away = towardZero + Math.sign(minor) * unit
  return up || Math.abs(rest) * 2 >= unit ? away : towardZero
}

/** Months from this month to `month`, both counted: this month is month 1. */
const monthsTo = (today: IsoDate, month: IsoDate) => (Number(month.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(month.slice(5, 7)) - Number(today.slice(5, 7)) + 1

/**
 * Every word and row shown for a what-if, built from goalWhatIf's result: whole units only,
 * never a negative "free" as a bare number, and a summary of at most two sentences (the verdict
 * and one more); the thin-estimate note, savings-only and only-this-goal lines go on the card.
 * The verdict is the answer itself (a month, or an amount a month); its caveat is the card's
 * second line.
 */
export function describeWhatIf(
  r: GoalWhatIf,
  a: { name: string; targetMinor: number; savedMinor: number; change: Change; deltaMinor: number; month: IsoDate | null; today: IsoDate; currency: string },
): Shown {
  const { name, today } = a
  const unit = 10 ** currencyMinorDigits(a.currency)
  const whole = (minor: number, up = false) => wholeMinor(minor, unit, up)
  const money = (minor: number, up = false) => formatMoney(whole(minor, up), { currency: a.currency })
  /** What is free for this goal a month, never as a negative amount. */
  const free = (minor: number) =>
    minor > 0 ? money(minor) : minor === 0 ? "nothing free" : `nothing free: short by ${money(-minor, true)} a month before this goal`
  /** The goal's cost after the change (only a cost change changes it). */
  const costAfter = a.change === "cost_more" || a.change === "cost_less" ? a.targetMinor + a.deltaMinor : a.targetMinor
  const size = money(Math.abs(a.deltaMinor))
  const lines = [SAVINGS_ONLY, ONLY_THIS_GOAL]
  const done = (verdict: string, text: string, figures: [string, number][] = []): Shown => ({ verdict, summary: `${verdict} ${text}`.trim(), lines, figures, notWithinYears: false })
  const { before, after } = r

  switch (r.outcome) {
    case "no_target":
      return done("No target amount.", `${name} has no target amount, so there is nothing to work out.`)
    case "past_month":
      return done("That month has passed.", `${monthName(a.month!)} is before this month; name a month from ${monthName(monthStart(today))} on.`)
    case "no_cost_left":
      return done("Nothing left to save.", `At ${size} less, ${name} would cost nothing or less.`, [["Change in cost", whole(Math.abs(a.deltaMinor))]])
    case "reached":
      return done("Already reached.", `${name} is saved: ${money(a.savedMinor)} of ${money(costAfter)}${costAfter === a.targetMinor ? "" : `, at ${size} ${a.deltaMinor > 0 ? "more" : "less"}`}.`)
    case "too_early":
      return done("Too early to say.", `There are only ${before!.monthsMeasured} complete months of records, and at least 3 are needed.`)
  }

  const reach = (p: GoalProjection) =>
    p.plan.basis === "reached" ? "already saved" : p.reachMonth ? `${monthName(p.reachMonth)} (${monthsTo(today, p.reachMonth)} months)` : "not reached"
  const was = before!
  const wasFree = was.freeThisMonthMinor!
  if (was.thin) lines.push(`Only ${was.monthsMeasured} months have records, so the estimate is thin.`)
  const notWithinYears = was.reachMonth === null || after?.reachMonth === null
  if (notWithinYears) lines.push(`"Not reached" means not within ${YEARS} years at that rate.`)
  /** The free-money figure: what is free, or what is short before this goal. */
  const freeFigure = (label: string, minor: number): [string, number] => (minor >= 0 ? [label, whole(minor)] : [`${label}: short before this goal`, whole(-minor, true)])
  const nothingFreeLine = (extra: string) => `Your records show nothing free a month today; this assumes you find the ${extra}.`

  if (a.change === "by_month") {
    const by = r.byMonth!
    const target = monthName(by.month)
    const figures: [string, number][] = [
      ["Still needed", whole(was.plan.remainingMinor)],
      [`Needed a month to reach it by ${target}`, whole(by.neededMonthlyMinor, true)],
      freeFigure("Free for this goal this month", wasFree),
    ]
    const answer = `${money(by.neededMonthlyMinor, true)} a month for ${by.months} ${by.months === 1 ? "month" : "months"}.`
    if (by.extraMonthlyMinor === 0) {
      return {
        ...done(answer, `What your records show free covers it: ${name} would be reached in ${reach(after!)}, by ${target}.`, figures),
        caveat: "Within what your records show is free today.",
        notWithinYears,
      }
    }
    figures.push(["Short a month", whole(by.extraMonthlyMinor, true)])
    const short = money(by.extraMonthlyMinor, true)
    lines.push(r.floored ? nothingFreeLine(`${short} a month`) : `Short by ${short} a month on what your records show free from this month to ${target}.`)
    const text = r.floored
      ? `Your records show ${free(wasFree)}, so all of it would have to come from elsewhere to reach ${name} by ${target}.`
      : `That is ${short} a month more than your records show free, to reach ${name} by ${target}.`
    return {
      ...done(answer, text, figures),
      caveat: "More than your records show is free today.",
      notWithinYears,
      comparison: {
        before: "As it is",
        after: `${short} ${r.floored ? "a month" : "more a month"}`,
        rows: [
          { label: "For this goal a month", before: free(wasFree), after: money(after!.freeThisMonthMinor!) },
          { label: "Reached in", before: reach(was), after: reach(after!) },
        ],
      },
    }
  }

  const now = after!
  const verdict = r.outcome === "projected" ? `Reached in ${reach(now)}.` : "Not reached."
  if (a.change === "save_more" || a.change === "save_less") {
    const more = a.deltaMinor > 0
    const figures: [string, number][] = [freeFigure("Free for this goal this month", wasFree), [more ? "Saved more a month" : "Saved less a month", whole(Math.abs(a.deltaMinor))]]
    if (now.freeThisMonthMinor! > 0) figures.push(["For this goal this month, with the change", whole(now.freeThisMonthMinor!)])
    const nothingLeft = !more && now.freeThisMonthMinor! <= 0
    const caveat = more
      ? wasFree > 0
        ? `Your records show ${money(wasFree)} free a month today; this assumes you find the extra ${size}.`
        : nothingFreeLine(`extra ${size}`)
      : nothingLeft
        ? `${size} less a month leaves nothing free for it.`
        : `${size} a month less than your records show free today.`
    const going = r.floored ? `With ${size} a month going to ${name}` : `Saving ${size} ${more ? "more" : "less"} a month (${free(now.freeThisMonthMinor!)} for it this month)`
    const text =
      r.outcome === "projected"
        ? `${going}, it would be reached in ${reach(now)}, instead of ${r.floored ? "not at all" : reach(was)}.`
        : nothingLeft
          ? `Saving ${size} less a month leaves nothing free for ${name}.`
          : `${going}, it would not be reached within ${YEARS} years.`
    return {
      verdict,
      caveat,
      summary: `${verdict} ${text}`,
      lines,
      figures,
      notWithinYears,
      comparison: {
        before: "As it is",
        after: r.floored ? `${size} a month` : `${size} ${more ? "more" : "less"} a month`,
        rows: [
          { label: "For this goal a month", before: free(wasFree), after: free(now.freeThisMonthMinor!) },
          { label: "Reached in", before: reach(was), after: nothingLeft ? "not reached" : reach(now) },
        ],
      },
    }
  }

  const more = a.deltaMinor > 0
  const figures: [string, number][] = [
    [more ? "Costs more" : "Costs less", whole(Math.abs(a.deltaMinor))],
    [`${name}: target, with the change`, whole(costAfter)],
    ["Still needed, with the change", whole(now.plan.remainingMinor)],
    freeFigure("Free for this goal this month", wasFree),
  ]
  const cost = money(costAfter)
  const text =
    r.outcome === "projected"
      ? `If ${name} cost ${size} ${more ? "more" : "less"} (${cost} in all), it would be reached in ${reach(now)}, instead of ${reach(was)}.`
      : `If ${name} cost ${size} ${more ? "more" : "less"} (${cost} in all), it would not be reached${wasFree <= 0 ? ": your records show nothing free for it" : ` within ${YEARS} years`}.`
  return {
    verdict,
    caveat: `If it costs ${size} ${more ? "more" : "less"} (${cost} in all).`,
    summary: `${verdict} ${text}`,
    lines,
    figures,
    notWithinYears,
    comparison: {
      before: "As it is",
      after: `Costing ${size} ${more ? "more" : "less"}`,
      rows: [
        { label: "Cost", before: money(a.targetMinor), after: cost },
        { label: "For this goal a month", before: free(wasFree), after: free(now.freeThisMonthMinor!) },
        { label: "Reached in", before: reach(was), after: reach(now) },
      ],
    },
  }
}
