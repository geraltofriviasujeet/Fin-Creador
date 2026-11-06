import { beforeEach, describe, expect, it, vi } from "vitest"
import type { GoalRecord, LoansView, UserClient } from "@fin-creador/api"
import { cashFlowReport, monthStart } from "@fin-creador/domain"
import { withVerdict } from "../chat"
import { allowedNumbers, checkAnswer, literalStrings } from "../output"
import { CANT_ESTIMATE, tripCheckTool } from "./trip"
import { type ToolContext, ToolError } from "./types"

// trip_check (10.5) against stubbed loaders; the Goals view, tripEstimate and goalProjection
// run for real. Scaling and run rules are tested in packages/domain.

const api = vi.hoisted(() => ({
  loadGoalsData: vi.fn(),
  loadCashFlow: vi.fn(),
  loadLoansData: vi.fn(),
  buildLoansView: vi.fn(),
  loadTransactionPage: vi.fn(),
  loadDashboardBreakdown: vi.fn(),
}))
vi.mock("@fin-creador/api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }))

const TODAY = "2026-11-06"
const categories = vi.fn()
const supabase = { from: () => ({ select: () => ({ eq: () => ({ eq: categories }) }) }) } as unknown as UserClient
const ctx: ToolContext = { supabase, today: TODAY, currency: "INR", descriptionsOk: false }

const goaCosts = { transport: 2_000_000, stay: 3_000_000, food: 1_000_000, activities: 0, visaInsurance: 0, shopping: 0, buffer: 0 }

const goal = (over: Partial<GoalRecord> = {}): GoalRecord => ({
  id: "g1",
  type: "other",
  name: "Bike",
  targetMinor: 6_000_000,
  savedMinor: 0,
  currency: "INR",
  targetDate: "2027-09-30",
  details: { v: 1 },
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
})

/** A done trip goal: 2 people, 4 days, ₹20,000 transport and ₹40,000 a trip in other lines. */
const goaGoal = goal({
  id: "goa",
  type: "trip",
  name: "Goa",
  targetMinor: 6_000_000,
  targetDate: "2026-03-31",
  archivedAt: "2026-04-01T00:00:00Z",
  details: { v: 1, scope: "domestic", place: "Goa", people: 2, days: 4, travelMode: "flight", stay: "hotel", costs: goaCosts },
})

function cash() {
  const months = Array.from({ length: 7 }, (_, i) => monthStart(TODAY, i - 6))
  const monthly = months.map((m, i) => ({ month: m, incomeMinor: i < 6 ? 1_000_000 : 0, expenseMinor: 0, categories: [] }))
  return { ok: true, data: { today: TODAY, currency: "INR", report: cashFlowReport(monthly, TODAY), otherCurrencies: [] } }
}

const emptyLoans = { loans: [], shortTerm: { borrowings: [] }, statutory: { dues: [] } } as unknown as LoansView

/** One travel run, 3 to 7 March 2026: ₹25,000 on Travel, ₹37,500 all spending. */
function setUp({ goals = [] as GoalRecord[], travelDates = ["2026-03-07", "2026-03-05", "2026-03-03"] } = {}) {
  api.loadGoalsData.mockResolvedValue({ ok: true, data: { today: TODAY, currency: "INR", goals, budgetRows: [], categories: [], spending: new Map() } })
  api.loadCashFlow.mockResolvedValue(cash())
  api.loadLoansData.mockResolvedValue({ ok: true, data: {} })
  api.buildLoansView.mockReturnValue(emptyLoans)
  categories.mockResolvedValue({ data: [{ id: "travel", name: "Travel" }], error: null })
  api.loadTransactionPage.mockResolvedValue({ ok: true, items: travelDates.map((occurredOn) => ({ occurredOn })), nextCursor: null })
  api.loadDashboardBreakdown.mockResolvedValue({
    ok: true,
    data: {
      byCategory: [
        { categoryId: "travel", expenseMinor: 2_500_000 },
        { categoryId: "food", expenseMinor: 1_250_000 },
      ],
    },
  })
}

const trip = { destination: "Kerala", scope: "domestic" as const, month: "2027-04", nights: 3, travellers: 2 }
const marchRun = { from: "2026-03-03", to: "2026-03-07", travellers: 2, scope: "domestic" as const }

type Out = Awaited<ReturnType<typeof tripCheckTool.run>>
const passes = (text: string, out: Out) =>
  checkAnswer(
    text,
    allowedNumbers(out.figures, [TODAY, ...(out.dates ?? []), ...(out.period ? [out.period.start, out.period.end] : [])]),
    literalStrings([out.data, out.figures.map((f) => f.label)]),
  ).ok

beforeEach(() => vi.clearAllMocks())

describe("trip_check", () => {
  it("asks for what the person hasn't said, without loading anything", async () => {
    const out = await tripCheckTool.run(ctx, { destination: "Kerala", nights: 3 })
    expect(out.data).toMatchObject({ ask_for: ["scope", "month", "travellers"] })
    expect(out.figures).toEqual([])
    expect(api.loadGoalsData).not.toHaveBeenCalled()
  })

  it("refuses a month that has passed", async () => {
    setUp()
    await expect(tripCheckTool.run(ctx, { ...trip, month: "2026-10" })).rejects.toThrow(ToolError)
  })

  it("can't estimate without a comparable, and lists the run with both figures added up from the records", async () => {
    setUp()
    const out = await tripCheckTool.run(ctx, trip)
    expect(out.check?.verdict).toBe(CANT_ESTIMATE)
    expect(out.data).toMatchObject({
      can_estimate: false,
      travel_runs_found: [{ from: "2026-03-03", to: "2026-03-07", days: 5, travel_category: "₹25,000", all_spending_in_those_dates: "₹37,500", used: false }],
    })
    expect(out.check!.summary).toContain("₹25,000 on Travel, ₹37,500 all spending in those dates")
    expect(out.figures.map((f) => f.label)).toContain(
      "Travel run 2026-03-03 to 2026-03-07: all spending in those dates, which may include things unrelated to the trip",
    )
    expect(api.loadDashboardBreakdown).toHaveBeenCalledWith(supabase, { start: "2026-03-03", end: "2026-03-07" }, "INR")
    expect(passes(out.check!.summary, out)).toBe(true)
    // An answer that guesses instead is replaced by the code-built summary.
    expect(withVerdict("It would cost about ₹50,000.", [out.check!])).toBe(out.check!.summary)
  })

  it("says so plainly when there are no travel runs either", async () => {
    setUp({ travelDates: [] })
    const out = await tripCheckTool.run(ctx, trip)
    expect(out.check?.summary).toBe(
      `${CANT_ESTIMATE} There is no domestic trip to scale from: no domestic trip goal with costs, and no past domestic trip confirmed. A trip goal with its costs filled in would also do.`,
    )
    expect(api.loadDashboardBreakdown).not.toHaveBeenCalled()
  })

  it("doesn't use a trip of the other scope", async () => {
    setUp({ goals: [goaGoal] })
    const out = await tripCheckTool.run(ctx, { ...trip, scope: "international" })
    expect(out.check?.verdict).toBe(CANT_ESTIMATE)
  })

  it("scales a confirmed run from its Travel-category figure", async () => {
    setUp()
    const out = await tripCheckTool.run(ctx, { ...trip, past_trips: [{ ...marchRun, basis: "travel" }] })
    // ₹25,000 over 2 travellers × 5 days = ₹2,500 a traveller-day; 2 travellers × 4 days.
    expect(out.data).toMatchObject({ estimate: "₹20,000", verdict: "Yes." })
    expect(out.check!.assumptions.join(" ")).toContain("Travel category only")
    expect(passes(out.check!.summary, out)).toBe(true)
  })

  it("scales a confirmed run from all spending in its dates", async () => {
    setUp()
    const out = await tripCheckTool.run(ctx, { ...trip, past_trips: [{ ...marchRun, basis: "all_spending" }] })
    expect(out.data).toMatchObject({ estimate: "₹30,000", verdict: "Yes." })
    expect(out.check!.assumptions.join(" ")).toContain("all spending in those dates, which may include things unrelated to the trip")
  })

  it("never takes an amount from the model: the input has no amount, and an unknown run is refused", async () => {
    expect(tripCheckTool.input.safeParse({ ...trip, past_trips: [{ ...marchRun, basis: "travel", amount: "₹1" }] }).success).toBe(false)
    setUp()
    await expect(tripCheckTool.run(ctx, { ...trip, past_trips: [{ ...marchRun, from: "2026-03-04", basis: "travel" }] })).rejects.toThrow(
      "isn't one of the travel runs found",
    )
  })

  it("says Yes from a trip goal, with the estimate and what it came from", async () => {
    setUp({ goals: [goaGoal] })
    const out = await tripCheckTool.run(ctx, trip)
    expect(out.check).toMatchObject({ kind: "trip", goal: "Kerala", verdict: "Yes." })
    expect(out.check!.summary).toBe(
      "Yes. A 3-night domestic trip to Kerala in April 2027 for 2 travellers would cost about ₹60,000, estimated from your own records. By April 2027 you would have ₹60,000 free for it.",
    )
    expect(out.data).toMatchObject({ comparables_used: [{ what: "Goa trip goal", scaled_to_this_trip: "₹60,000" }] })
    expect(out.check!.assumptions.join(" ")).toContain("what was planned, not what was spent")
    expect(passes(out.check!.summary, out)).toBe(true)
  })

  it("says No with what would have to change: more a month, a later month, fewer nights or travellers", async () => {
    setUp({ goals: [goaGoal] })
    const out = await tripCheckTool.run(ctx, { ...trip, nights: 9 })
    expect(out.check!.summary).toBe(
      "No. A 9-night domestic trip to Kerala in April 2027 for 2 travellers would cost about ₹1,20,000, estimated from your own records. By April 2027 you would have ₹60,000 free for it. To go in April 2027, save ₹10,000 more a month, or go in October 2027, or make it 3 nights, or go with 1 traveller.",
    )
    expect(passes(out.check!.summary, out)).toBe(true)
  })

  it("names the goals the trip would push past their targets", async () => {
    setUp({ goals: [goaGoal, goal()] })
    const out = await tripCheckTool.run(ctx, trip)
    expect(out.data).toMatchObject({ verdict: "No.", goals_that_would_slip: [{ goal: "Bike", reached_in: "October 2027" }] })
    expect(out.check!.summary).toContain("Paying for it would make you miss the target for Bike (reached in October 2027).")
    expect(passes(out.check!.summary, out)).toBe(true)
  })

  it("checks an existing trip goal with goal_projection", async () => {
    setUp({ goals: [goal({ ...goaGoal, archivedAt: null, targetDate: "2027-04-30" })] })
    const out = await tripCheckTool.run(ctx, { goal: "goa" })
    expect(out.check).toMatchObject({ goal: "Goa", verdict: "Yes." })
  })
})
