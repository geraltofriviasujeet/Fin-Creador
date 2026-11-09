import { describe, expect, it } from "vitest"
import { changeParts, lineCaption, planHeading, planVerdictCard, recordsLine, totalFigure } from "./format"
import { type CheckedPlan, type PlanLine, checkedPlanSchema } from "./types"

// The modal's and the PDF's wording (redesign, 2026-11-09): all from the checked plan.

const line = (name: PlanLine["line"]): PlanLine => ({ line: name, from: "none", amounts: [], how: "", prices: [], pages: [] })
const trip = { kind: "trip", destination: "Chennai", origin: "Delhi", month: "2026-12", nights: 5, travellers: 2, style: "comfort" } as const

function plan(over: Partial<CheckedPlan>): CheckedPlan {
  return checkedPlanSchema.parse({
    v: 1,
    kind: "trip",
    intake: { title: "Plan: trip from Delhi to Chennai in December 2026", fields: [], request: trip },
    lines: [],
    saved: null,
    carriers: null,
    hotels: null,
    verdicts: { totals: [], records: { verdict: "No verdict.", summary: "" }, web: { verdict: "No.", summary: "No. With web estimates the plan adds up to ₹77,387." } },
    changes: [],
    assumptions: [],
    sources: [],
    ...over,
  })
}

describe("the plan's heading", () => {
  it("a trip: route and month, nights, travellers and the day it was made", () => {
    expect(planHeading(plan({}), "2026-11-08")).toEqual({
      eyebrow: "Roma · Travel plan",
      title: "Delhi to Chennai · December 2026",
      subline: "5 nights · 2 travellers · Created 8 Nov 2026",
    })
  })
  it("a purchase, and an older plan without its request", () => {
    const car = plan({ kind: "purchase", intake: { title: "Plan: buying Hyundai Creta", fields: [], request: { kind: "purchase", item: "car", make: "Hyundai", model: "Creta", month: "2027-03", depositMinor: null } } })
    expect(planHeading(car, "2026-11-08")).toEqual({ eyebrow: "Roma · Purchase plan", title: "Hyundai Creta · March 2027", subline: "Created 8 Nov 2026" })
    expect(planHeading(plan({ intake: { title: "Plan: trip to Goa", fields: [] } }), "2026-11-08").title).toBe("Plan: trip to Goa")
  })
})

describe("a cost line's sub-label", () => {
  it("says what the line covers, from the request", () => {
    const p = plan({})
    expect(lineCaption(line("stay"), p)).toBe("5 nights · mid-range stay")
    expect(lineCaption(line("transport"), p)).toBe("Delhi to Chennai for 2 travellers")
    expect(lineCaption(line("food"), p)).toBe("6 days · 2 travellers")
    expect(lineCaption(line("shopping"), p)).toBe("Not estimated: it is up to you")
  })
  it("has none for an older plan's trip line", () => {
    expect(lineCaption(line("stay"), plan({ intake: { title: "Plan", fields: [] } }))).toBeNull()
  })
})

describe("the verdict card", () => {
  it("a trip from both signals", () => {
    const both = { verdict: "Not yet.", summary: "The money is the constraint, not the trip.", money: { met: "no", summary: "" }, past: { met: "yes", summary: "" } } as const
    const p = plan({ verdicts: { totals: [], records: { verdict: "No verdict.", summary: "" }, web: { verdict: "No.", summary: "" }, both } })
    expect(planVerdictCard(p)).toEqual({ status: "adjust", headline: "This trip does not fit your current plan yet.", reason: "The money is the constraint, not the trip." })
  })
  it("a purchase from the web estimates' projection, its verdict word dropped from the reason", () => {
    expect(planVerdictCard(plan({ kind: "purchase" }))).toEqual({ status: "adjust", headline: "This purchase does not fit your current plan yet.", reason: "With web estimates the plan adds up to ₹77,387." })
  })
  it("can't say without a verdict", () => {
    const p = plan({ verdicts: { totals: [], records: { verdict: "No verdict.", summary: "" }, web: { verdict: "No verdict.", summary: "No web estimates in this plan." } } })
    expect(planVerdictCard(p)).toMatchObject({ status: "unknown", headline: "Roma can't say yet whether this trip fits." })
  })
})

describe("stat cards and ways to make it fit", () => {
  it("one figure, the median, rounded to whole rupees; the range and its kind in the caption", () => {
    expect(totalFigure({ currency: "INR", low: "33873.58", high: "258862.21", median: "77386.6" }, true)).toEqual({
      value: "₹77,387",
      caption: "Median of web estimates · ₹33,874 to ₹2,58,862",
    })
    expect(totalFigure({ currency: "INR", low: "77387", high: "77387", bound: "at_least" }, true)).toEqual({ value: "₹77,387", caption: "From web estimates · a minimum" })
    expect(totalFigure({ currency: "INR", low: "5000", high: "5000" }, false)).toEqual({ value: "₹5,000", caption: "From estimates" })
  })
  it("an older plan without a median shows its range, rounded", () => {
    expect(totalFigure({ currency: "INR", low: "33873.58", high: "258862.21" }, true)).toEqual({ value: "₹33,874 to ₹2,58,862", caption: "Range of web estimates" })
  })
  it("an older plan's sentence splits into a title and a line", () => {
    expect(changeParts("Fewer nights: stay, food and local travel come down.")).toEqual({ title: "Fewer nights", detail: "Stay, food and local travel come down." })
    expect(changeParts("Go in April 2027 instead.")).toEqual({ title: "Go in April 2027 instead", detail: null })
    expect(changeParts({ title: "Fewer nights", detail: "Stay comes down." })).toEqual({ title: "Fewer nights", detail: "Stay comes down." })
  })
})

describe("the records-only verdict line", () => {
  it("says the verdict once when the summary already starts with it", () => {
    expect(recordsLine({ verdict: "No verdict.", summary: "No verdict from your records: the month was skipped." })).toBe("No verdict from your records: the month was skipped.")
    expect(recordsLine({ verdict: "No estimate from your records.", summary: "No estimate from your records. There is no trip to scale from." })).toBe(
      "No estimate from your records. There is no trip to scale from.",
    )
    expect(recordsLine({ verdict: "Yes.", summary: "At your current rate it is covered by March." })).toBe("Yes. At your current rate it is covered by March.")
  })
})
