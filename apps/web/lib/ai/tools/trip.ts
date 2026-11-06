import { z } from "zod"
import { type GoalItem, type UserClient, loadDashboardBreakdown, loadTransactionPage } from "@fin-creador/api"
import {
  type GoalProjection,
  type IsoDate,
  TRIP_LOOKBACK_MONTHS,
  TRIP_RUN_GAP_DAYS,
  type TravelRun,
  type TripComparable,
  type TripScope,
  type TripSize,
  addMinor,
  findTravelRuns,
  formatMoney,
  goalProjection,
  largestThatFits,
  monthStart,
  tripEstimate,
} from "@fin-creador/domain"
import {
  type ProjectionBasis,
  VERDICT_WORDS,
  basisFigures,
  buildAssumptions,
  goalProjectionTool,
  loadProjectionBasis,
  monthName,
  otherGoals,
  YEARS,
} from "./goals"
import { type Figure, type FinanceTool, type GoalCheck, type ToolContext, ToolError } from "./types"

// trip_check (Sprint 10.5): what a trip would cost, from the person's own records only, and
// whether they can pay for it by the month they want. The estimate is tripEstimate and the
// verdict goalProjection (packages/domain, rules there); the model only puts them into words.
//   * Comparables: trip goals (active or done) with their cost lines, and past travel runs
//     the person confirmed in this conversation (how many travelled, domestic or
//     international, and which figure to use). Nothing is stored: a confirmation lasts for
//     the conversation.
//   * A run's two figures are added up from the records here, never taken from the model:
//     the Travel category alone, and all spending in the same dates.
//   * No comparable of the trip's scope: "I can't estimate this from your records.", never a
//     guess. Without web research until 10.8.
//   * An existing trip goal is checked by goal_projection.

/** Runs offered (newest first): each costs one dashboard_breakdown call. */
export const MAX_RUNS = 6
/** list_transactions pages read per Travel category (100 entries each). */
const MAX_PAGES = 5
const PAGE = 100

export const CANT_ESTIMATE = "I can't estimate this from your records."

const isoDate = z.iso.date()
const scope = z.enum(["domestic", "international"])

const pastTrip = z
  .object({
    from: isoDate.describe("First day of a travel run trip_check listed."),
    to: isoDate.describe("Last day of that run."),
    travellers: z.number().int().min(1).max(100).describe("How many travelled, as the person said."),
    scope: scope.describe("Domestic or international, as the person said."),
    basis: z
      .enum(["travel", "all_spending"])
      .describe("The figure the person picked: 'travel' (Travel category only) or 'all_spending' (all spending in those dates)."),
  })
  .strict()

const input = z
  .object({
    goal: z.string().trim().min(1).max(80).optional().describe("An existing trip goal's name. Leave out for a new trip."),
    destination: z.string().trim().min(1).max(80).optional().describe("Where, as the person said it."),
    scope: scope.optional().describe("Domestic or international, as the person said. Never assume it."),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional()
      .describe("The month they want to travel, YYYY-MM."),
    nights: z.number().int().min(1).max(364).optional(),
    travellers: z.number().int().min(1).max(100).optional(),
    past_trips: z
      .array(pastTrip)
      .max(MAX_RUNS)
      .optional()
      .describe("Travel runs the person confirmed as trips in this conversation, with their answers. Never fill these in yourself."),
  })
  .strict()

export type TripInput = z.infer<typeof input>

const REQUIRED = ["destination", "scope", "month", "nights", "travellers"] as const

const ASK: Record<(typeof REQUIRED)[number], string> = {
  destination: "where you want to go",
  scope: "whether the trip is domestic or international",
  month: "the month you want to travel",
  nights: "how many nights",
  travellers: "how many people are travelling",
}

/** What Roma asks when details are missing, built here and shown as is (never the model's text). */
export function tripQuestion(destination: string | undefined, missing: readonly (typeof REQUIRED)[number][]): string {
  const items = missing.map((k) => ASK[k])
  const list = items.length === 1 ? items[0]! : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
  const trip = destination ? `a trip to ${destination}` : "a trip"
  return `To estimate ${trip} from your records, Roma needs to know ${list}. Tell her these and ask again.`
}

/** A run with its two figures, added up from the records (profile currency, expenses net of refunds). */
export type PricedRun = TravelRun & { travelMinor: number; allMinor: number }

const runLabel = (r: { from: IsoDate; to: IsoDate }) => `Travel run ${r.from} to ${r.to}`

/** The Travel categories: the seeded one (icon travel, found after a rename too), archived ones included. */
async function travelCategories(supabase: UserClient) {
  const { data, error } = await supabase.from("categories").select("id, name").eq("kind", "expense").eq("icon", "travel")
  if (error) throw new ToolError("The categories couldn't be loaded.")
  return data
}

/** Dates of Travel expenses in the look-back window. */
async function travelDates(ctx: ToolContext, categoryIds: readonly string[], from: IsoDate): Promise<IsoDate[]> {
  const dates: IsoDate[] = []
  for (const categoryId of categoryIds) {
    let cursor = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await loadTransactionPage(
        ctx.supabase,
        { from, to: ctx.today, type: "expense", categoryId },
        { currency: ctx.currency, cursor, limit: PAGE },
      )
      if (!result.ok) throw new ToolError("The travel entries couldn't be loaded.")
      dates.push(...result.items.map((i) => i.occurredOn))
      if (result.nextCursor === null) break
      cursor = result.nextCursor
    }
  }
  return dates
}

/** Both figures for each run, from dashboard_breakdown over its dates. */
async function priceRuns(ctx: ToolContext, runs: readonly TravelRun[], travelIds: ReadonlySet<string>): Promise<PricedRun[]> {
  const results = await Promise.all(runs.map((r) => loadDashboardBreakdown(ctx.supabase, { start: r.from, end: r.to }, ctx.currency)))
  return runs.map((run, i) => {
    const result = results[i]!
    if (!result.ok) throw new ToolError("The travel figures couldn't be loaded.")
    const rows = result.data.byCategory
    return {
      ...run,
      travelMinor: addMinor(...rows.filter((r) => r.categoryId !== null && travelIds.has(r.categoryId)).map((r) => r.expenseMinor)),
      allMinor: addMinor(...rows.map((r) => r.expenseMinor)),
    }
  })
}

/** Trip goals (active or done) in the currency, with at least one cost line. */
export function goalComparables(items: readonly GoalItem[], currency: string): TripComparable[] {
  const out: TripComparable[] = []
  for (const item of items) {
    if (item.goal.currency !== currency || item.answers?.type !== "trip") continue
    const d = item.answers.details
    if (Object.values(d.costs).every((c) => c === 0)) continue
    out.push({ kind: "goal", name: item.goal.name, scope: d.scope, days: d.days, travellers: d.people, costs: d.costs })
  }
  return out
}

/** The confirmed runs, each matched to a run found in the records; its amount is the figure picked. */
export function confirmedRuns(confirmed: TripInput["past_trips"], priced: readonly PricedRun[]): TripComparable[] {
  return (confirmed ?? []).map((c) => {
    const run = priced.find((r) => r.from === c.from && r.to === c.to)
    if (!run) throw new ToolError(`${c.from} to ${c.to} isn't one of the travel runs found. Use only the runs trip_check listed.`)
    const amountMinor = c.basis === "travel" ? run.travelMinor : run.allMinor
    if (amountMinor <= 0) throw new ToolError(`${runLabel(run)} has no spending to scale from with that figure.`)
    return { kind: "run", from: run.from, to: run.to, scope: c.scope, days: run.days, travellers: c.travellers, amountMinor }
  })
}

export const tripCheckTool: FinanceTool<TripInput> = {
  name: "trip_check",
  description:
    "Estimates what a trip would cost from the person's own records (their trip goals and past travel spending), then checks whether they can pay for it by the month they want, what it does to their other goals and what would have to change. Needs destination, domestic or international, month, nights and travellers, all as the person said; or the name of an existing trip goal. It lists past travel runs with two figures each for the person to confirm. Use it for any question about a trip's cost or whether a trip is affordable.",
  input,
  async run(ctx, p) {
    if (p.goal !== undefined) return goalProjectionTool.run(ctx, { goal: p.goal })

    const missing = REQUIRED.filter((k) => p[k] === undefined)
    if (missing.length > 0) {
      return {
        data: { ask_for: missing, note: "The app asks the person for these itself. Reply in one short sentence without numbers." },
        figures: [],
        needs: { tool: "trip_check", missing: [...missing], question: tripQuestion(p.destination, missing) },
      }
    }
    const { today, currency } = ctx
    const destination = p.destination!
    const tripScope = p.scope as TripScope
    const travelMonth = `${p.month!}-01`
    if (travelMonth < monthStart(today)) throw new ToolError(`${monthName(travelMonth)} has passed. Ask for a month from now on.`)
    const size: TripSize = { days: p.nights! + 1, travellers: p.travellers! }

    const lookback = monthStart(today, -TRIP_LOOKBACK_MONTHS)
    const [basis, categories] = await Promise.all([loadProjectionBasis(ctx), travelCategories(ctx.supabase)])
    const runs = findTravelRuns(await travelDates(ctx, categories.map((c) => c.id), lookback)).slice(0, MAX_RUNS)
    const priced = await priceRuns(ctx, runs, new Set(categories.map((c) => c.id)))
    const comparables = [...goalComparables([...basis.goals.active, ...basis.goals.archived], currency), ...confirmedRuns(p.past_trips, priced)]
    const estimate = tripEstimate(comparables, tripScope, size)

    const money = (minor: number) => formatMoney(minor, { currency })
    const trip = `A ${p.nights}-night ${tripScope} trip to ${destination} in ${monthName(travelMonth)} for ${p.travellers} ${p.travellers === 1 ? "traveller" : "travellers"}`
    const runFigures = priced.flatMap((r): Figure[] => [
      { label: `${runLabel(r)}: Travel category`, kind: "money", minor: r.travelMinor, currency },
      { label: `${runLabel(r)}: all spending in those dates, which may include things unrelated to the trip`, kind: "money", minor: r.allMinor, currency },
      { label: `${runLabel(r)}: days`, kind: "count", value: r.days },
    ])
    const runData = priced.map((r) => ({
      from: r.from,
      to: r.to,
      days: r.days,
      travel_category: money(r.travelMinor),
      all_spending_in_those_dates: money(r.allMinor),
      used: comparables.some((c) => c.kind === "run" && c.from === r.from),
    }))
    const sizeFigures: Figure[] = [
      { label: "Nights", kind: "count", value: p.nights! },
      { label: "Travellers", kind: "count", value: p.travellers! },
      { label: "Days counted", kind: "count", value: size.days },
    ]
    const runDates = priced.flatMap((r) => [r.from, r.to])

    if (!estimate) {
      const confirm =
        priced.length > 0
          ? ` These look like past trips: ${priced.map((r) => `${r.from} to ${r.to}, ${money(r.travelMinor)} on Travel, ${money(r.allMinor)} all spending in those dates`).join("; ")}. If one was a ${tripScope} trip, say how many travelled and which figure to use (all spending in those dates may include things unrelated to the trip).`
          : ""
      const summary = `${CANT_ESTIMATE} There is no ${tripScope} trip to scale from: no ${tripScope} trip goal with costs, and no past ${tripScope} trip confirmed.${confirm} A trip goal with its costs filled in would also do.`
      const check: GoalCheck = { kind: "trip", goal: destination, verdict: CANT_ESTIMATE, summary, assumptions: [] }
      return {
        data: {
          can_estimate: false,
          verdict: CANT_ESTIMATE,
          verdict_summary: summary,
          travel_runs_found: runData,
          note: `Start the answer with "${CANT_ESTIMATE}" exactly. Never guess a cost. ${
            priced.length > 0
              ? "List the travel runs with both figures; ask which, if any, was a trip of this kind, how many travelled and which figure to use. Then call trip_check again with past_trips."
              : "Suggest adding a trip goal with its costs."
          }`,
        },
        figures: [...sizeFigures, ...runFigures],
        dates: [lookback, today, travelMonth, ...runDates],
        check,
      }
    }

    const others = otherGoals(basis.goals.active, currency, null)
    const { claims } = basis
    const projection = goalProjection({
      today,
      targetMinor: estimate.estimateMinor,
      savedMinor: 0,
      targetDate: travelMonth,
      months: basis.complete,
      claims: [...claims.loans, ...claims.dues],
      otherGoals: others.map((g) => g.plan),
    })
    const slipped = projection.medianNetMinor === null ? [] : goalsThatSlip(basis, others, projection, today)
    const available = projection.availableByTargetMinor
    const fits = (dimension: keyof TripSize, upTo: number) =>
      projection.verdict === "no" && available !== null && upTo >= 1 ? largestThatFits(comparables, tripScope, size, dimension, upTo, available) : null
    const daysFit = fits("days", size.days - 1)
    const nightsFit = daysFit !== null && daysFit >= 2 ? daysFit - 1 : null
    const travellersFit = fits("travellers", size.travellers - 1)
    const { loansNow, duesNow, netSoFar } = basisFigures(basis, today)
    const projected = projection.medianNetMinor !== null

    const figures: Figure[] = [
      { label: "Trip estimate", kind: "money", minor: estimate.estimateMinor, currency },
      ...sizeFigures,
      ...estimate.scaled.map(({ comparable: c, minor }): Figure => ({
        label: `${c.kind === "goal" ? `${c.name} trip goal` : runLabel(c)}, scaled to this trip`,
        kind: "money",
        minor,
        currency,
      })),
      { label: "Comparable trips used", kind: "count", value: estimate.scaled.length },
      ...runFigures,
      { label: "Trip: needed a month", kind: "money", minor: projection.plan.monthlyMinor, currency },
      { label: "Months with records", kind: "count", value: projection.monthsMeasured },
    ]
    if (projected) {
      figures.push(
        { label: "Median monthly net (income minus spending)", kind: "money", minor: projection.medianNetMinor!, currency },
        { label: "Loan, card EMI and borrowing payments this month", kind: "money", minor: loansNow, currency },
        { label: "Unpaid statutory dues this month", hideWhenZero: true, kind: "money", minor: duesNow, currency },
        ...others.map((g): Figure => ({ label: `Assuming you keep saving for your other goals: ${g.goal.name}, a month`, kind: "money", minor: g.plan.monthlyMinor, currency })),
        { label: "Free for this trip this month", kind: "money", minor: projection.freeThisMonthMinor!, currency },
      )
      if (available !== null) figures.push({ label: `Free for it by ${monthName(travelMonth)}`, kind: "money", minor: available, currency })
    } else {
      figures.push({ label: "Net recorded so far", kind: "money", minor: netSoFar, currency })
    }
    if (projection.extraMonthlyMinor !== null) figures.push({ label: "Save more a month", kind: "money", minor: projection.extraMonthlyMinor, currency })
    if (slipped.some((s) => s.reachMonth === null)) figures.push({ label: "Projected at most, years", kind: "count", value: YEARS })
    if (nightsFit !== null) figures.push({ label: "Nights that fit", kind: "count", value: nightsFit })
    if (travellersFit !== null) figures.push({ label: "Travellers that fit", kind: "count", value: travellersFit })

    const summary = tripSummary({ trip, travelMonth, estimateMinor: estimate.estimateMinor, projection, slipped, nightsFit, travellersFit, money, netSoFar })
    const assumptions = [
      ...tripAssumptions(estimate.scaled.map((s) => s.comparable), tripScope, p.past_trips ?? []),
      ...buildAssumptions({
        ctx,
        projection,
        others,
        claims,
        otherCurrencies: basis.cash.otherCurrencies,
        windowStart: basis.windowStart,
        lastComplete: basis.lastComplete,
        noDateInvolved: others.some((g) => g.plan.basis === "assumed_months"),
        hasLoan: false,
      }),
    ]
    const check: GoalCheck = { kind: "trip", goal: destination, verdict: VERDICT_WORDS[projection.verdict], summary, assumptions }

    return {
      data: {
        trip,
        verdict: check.verdict,
        verdict_summary: summary,
        estimate: money(estimate.estimateMinor),
        comparables_used: estimate.scaled.map(({ comparable: c, minor }) => ({
          what: c.kind === "goal" ? `${c.name} trip goal` : runLabel(c),
          days: c.days,
          travellers: c.travellers,
          scaled_to_this_trip: money(minor),
        })),
        travel_runs_found: runData,
        needed_a_month: money(projection.plan.monthlyMinor),
        months_with_records: projection.monthsMeasured,
        thin_estimate: projection.thin,
        median_monthly_net: projected ? money(projection.medianNetMinor!) : null,
        free_this_month: projected ? money(projection.freeThisMonthMinor!) : null,
        free_by_travel_month: available === null ? null : money(available),
        reached_in: projection.reachMonth ? monthName(projection.reachMonth) : null,
        save_more_a_month: projection.extraMonthlyMinor === null ? null : money(projection.extraMonthlyMinor),
        nights_that_fit: nightsFit,
        travellers_that_fit: travellersFit,
        goals_that_would_slip: slipped.map((s) => ({ goal: s.name, reached_in: s.reachMonth ? monthName(s.reachMonth) : null })),
        assumptions,
        note: `Start the answer with "${check.verdict}" exactly, then the estimate and what it came from, then the figures, then what would have to change. verdict_summary says it all in order.`,
      },
      figures,
      period: { start: basis.windowStart, end: basis.lastComplete },
      dates: [
        travelMonth,
        ...runDates,
        ...(projection.reachMonth ? [projection.reachMonth] : []),
        ...slipped.flatMap((s) => (s.reachMonth ? [s.reachMonth] : [])),
      ],
      check,
    }
  },
}

type Slip = { name: string; reachMonth: IsoDate | null }

/** Dated goals that are on time now and would not be with the trip saved for as well. */
function goalsThatSlip(basis: ProjectionBasis, others: readonly GoalItem[], trip: GoalProjection, today: IsoDate): Slip[] {
  const claims = [...basis.claims.loans, ...basis.claims.dues]
  const slips: Slip[] = []
  for (const g of others) {
    if (g.plan.basis !== "target_date") continue
    const rest = others.filter((o) => o.goal.id !== g.goal.id).map((o) => o.plan)
    const run = (extra: (typeof rest)[number][]) =>
      goalProjection({
        today,
        targetMinor: g.goal.targetMinor,
        savedMinor: g.goal.savedMinor,
        targetDate: g.goal.targetDate,
        months: basis.complete,
        claims,
        otherGoals: [...rest, ...extra],
      })
    if (run([]).verdict !== "yes") continue
    const after = run([trip.plan])
    if (after.verdict === "no") slips.push({ name: g.goal.name, reachMonth: after.reachMonth })
  }
  return slips
}

export function tripSummary(a: {
  trip: string
  travelMonth: IsoDate
  estimateMinor: number
  projection: GoalProjection
  slipped: readonly Slip[]
  nightsFit: number | null
  travellersFit: number | null
  money: (minor: number) => string
  netSoFar: number
}): string {
  const p = a.projection
  const word = VERDICT_WORDS[p.verdict]
  const month = monthName(a.travelMonth)
  const head = `${word} ${a.trip} would cost about ${a.money(a.estimateMinor)}, estimated from your own records.`
  const thin = p.thin ? ` This is based on only ${p.monthsMeasured} months of records, so the estimate is thin.` : ""
  if (p.verdict === "too_early") {
    return `${head} There are only ${p.monthsMeasured} complete months of records, too few to say whether you can pay for it. It needs ${a.money(p.plan.monthlyMinor)} a month until ${month}. Your net so far: ${a.money(a.netSoFar)}.`
  }
  const free = p.availableByTargetMinor === null ? "" : ` By ${month} you would have ${a.money(p.availableByTargetMinor)} free for it.`
  const slip =
    a.slipped.length === 0
      ? ""
      : ` Paying for it would make you miss the target for ${a.slipped
          .map((s) => `${s.name} (${s.reachMonth ? `reached in ${monthName(s.reachMonth)}` : `not reached within ${YEARS} years`})`)
          .join(", ")}.`
  if (p.verdict === "yes") return `${head}${free}${slip}${thin}`
  const changes = [
    p.extraMonthlyMinor !== null ? `save ${a.money(p.extraMonthlyMinor)} more a month` : null,
    p.reachMonth ? `go in ${monthName(p.reachMonth)}` : null,
    a.nightsFit !== null ? `make it ${a.nightsFit} ${a.nightsFit === 1 ? "night" : "nights"}` : null,
    a.travellersFit !== null ? `go with ${a.travellersFit} ${a.travellersFit === 1 ? "traveller" : "travellers"}` : null,
  ].filter((c): c is string => c !== null)
  const change = changes.length > 0 ? ` To go in ${month}, ${changes.join(", or ")}.` : ""
  return `${head}${free}${change}${slip}${thin}`
}

function tripAssumptions(used: readonly TripComparable[], tripScope: TripScope, confirmed: NonNullable<TripInput["past_trips"]>): string[] {
  const list = [
    `The estimate is the median of what ${used.length} ${tripScope} ${used.length === 1 ? "trip" : "trips"} from your records scale to; ${tripScope === "domestic" ? "international" : "domestic"} trips aren't used. The destination itself isn't priced.`,
    `A trip of N nights is counted as N + 1 days. A trip goal's transport and visa/insurance scale per traveller and its other costs per traveller per day; a past travel run scales per traveller per day.`,
    "Past prices, not adjusted for price rises. No outside prices are looked up.",
  ]
  if (used.length === 1) list.push("Only one trip to compare with, so the estimate is thin.")
  if (used.some((c) => c.kind === "goal")) list.push("A trip goal's costs are what was planned, not what was spent.")
  for (const c of confirmed) {
    if (c.scope !== tripScope) continue
    list.push(
      c.basis === "travel"
        ? `${runLabel(c)}: Travel category only. Meals, local transport or shopping on that trip logged under other categories aren't counted, so this may understate it.`
        : `${runLabel(c)}: all spending in those dates, which may include things unrelated to the trip.`,
    )
  }
  list.push(`Past travel runs are Travel expenses no more than ${TRIP_RUN_GAP_DAYS} days apart in the last ${TRIP_LOOKBACK_MONTHS} months; what you said about them lasts for this conversation only.`)
  list.push("As with goals, the money is counted as needed by the end of the travel month. Bookings paid earlier need it sooner.")
  return list
}
