import { describe, expect, it } from "vitest"
import { buildPlan, detectPlan, intakeQuestions, monthIn, parseMonth } from "./intake"
import { planRequest } from "./types"

// The plan intake: which questions are plans, what they already say, and only the questions still needed.

const TODAY = "2026-11-07"

describe("recognising a plan", () => {
  it("fills in what a trip question already says, and asks only for the rest", () => {
    const draft = detectPlan("Plan my trip to Goa in January for 2 people, 4 nights", TODAY)
    expect(draft).toEqual({ kind: "trip", destination: "Goa", origin: null, month: "2027-01", nights: 4, travellers: 2, style: null })
    expect(intakeQuestions(draft!, TODAY).map((q) => q.field)).toEqual(["origin", "style"])
    expect(planRequest.safeParse(draft).success).toBe(true)
  })

  it("asks every trip field when the question names none, and drops a place not on the list", () => {
    const draft = detectPlan("Help me plan a trip to Atlantis", TODAY)!
    expect(draft).toMatchObject({ destination: null })
    expect(intakeQuestions(draft, TODAY).map((q) => q.field)).toEqual(["destination", "origin", "month", "nights", "travellers", "style"])
  })

  it("always asks where from, filled in when the question says it, so it can be changed", () => {
    const draft = detectPlan("Plan a trip from Delhi to Goa in January, 4 nights for 2 people, luxury", TODAY)!
    expect(draft).toMatchObject({ destination: "Goa", origin: "Delhi", style: "luxury" })
    expect(intakeQuestions(draft, TODAY)).toEqual([expect.objectContaining({ field: "origin", initial: "Delhi" })])
  })

  it("reads a purchase, its make and model from the app's list, and asks month and deposit", () => {
    const draft = detectPlan("Can I buy a Hyundai Creta next month?", TODAY)
    expect(draft).toEqual({ kind: "purchase", item: "car", make: "Hyundai", model: "Creta", month: "2026-12", depositMinor: null })
    expect(intakeQuestions(draft!, TODAY).map((q) => q.field)).toEqual(["depositMinor"])
  })

  it("asks use and budget for a vehicle the question doesn't name (a shortlist), make and model only behind 'I already know the model', and neither for a house", () => {
    const draft = detectPlan("Can I afford a bike?", TODAY)!
    expect(draft).toEqual({ kind: "purchase", item: "bike", make: null, model: null, month: null, depositMinor: null, use: null, budgetMinor: null })
    expect(intakeQuestions(draft, TODAY).map((q) => q.field)).toEqual(["use", "budgetMinor", "month", "depositMinor"])
    expect(intakeQuestions(draft, TODAY, true).map((q) => q.field)).toEqual(["make", "model", "month", "depositMinor"])
    expect(intakeQuestions(detectPlan("Can I buy a house in March 2028?", TODAY)!, TODAY).map((q) => q.field)).toEqual(["depositMinor"])
  })

  it("recognises the natural ways people ask for a trip plan, in code", () => {
    // The one from dev: no trip word, a route to a place on the list.
    expect(detectPlan("make my plan from delhi to shillong?", TODAY)).toMatchObject({ kind: "trip", origin: "Delhi", destination: "Shillong" })
    expect(detectPlan("plan my trip to Kerala", TODAY)).toMatchObject({ kind: "trip", destination: "Kerala" })
    expect(detectPlan("Plan a trip to Singapore", TODAY)).toMatchObject({ kind: "trip", destination: "Singapore" })
    // A place not on the app's list is still a trip; its destination is asked again.
    expect(detectPlan("Plan a trip to Bali", TODAY)).toMatchObject({ kind: "trip", destination: null })
    expect(detectPlan("I want to go to Shillong", TODAY)).toMatchObject({ kind: "trip", destination: "Shillong" })
    expect(detectPlan("We'd like to visit Japan in March", TODAY)).toMatchObject({ kind: "trip", destination: "Japan", month: "2027-03" })
    expect(detectPlan("help me plan our holiday to Goa", TODAY)).toMatchObject({ kind: "trip", destination: "Goa" })
    expect(detectPlan("Can I afford a trip to Thailand?", TODAY)).toMatchObject({ kind: "trip", destination: "Thailand" })
    expect(detectPlan("Should we take a vacation in December?", TODAY)).toMatchObject({ kind: "trip", destination: null, month: "2026-12" })
  })

  it("recognises the natural ways people ask for a purchase plan", () => {
    expect(detectPlan("should I buy a car", TODAY)).toMatchObject({ kind: "purchase", item: "car" })
    expect(detectPlan("I want to buy a bike", TODAY)).toMatchObject({ kind: "purchase", item: "bike" })
    expect(detectPlan("want to buy a car? can you suggest some under 1200000 budget", TODAY)).toMatchObject({ kind: "purchase", item: "car" })
    expect(detectPlan("We're thinking of buying a flat next year", TODAY)).toMatchObject({ kind: "purchase", item: "house" })
  })

  it("leaves questions about the past, and plans that aren't trips, to Roma's chat", () => {
    expect(detectPlan("how much did I spend on travel last year", TODAY)).toBeNull()
    expect(detectPlan("Did I take a trip last year?", TODAY)).toBeNull()
    expect(detectPlan("I want to go over my budget for October", TODAY)).toBeNull()
    expect(detectPlan("Make a plan to reduce my spending", TODAY)).toBeNull()
    expect(detectPlan("What did I spend on travel to Goa?", TODAY)).toBeNull()
  })

  it("says beside the month what skipping it costs", () => {
    const trip = intakeQuestions(detectPlan("Plan a trip to Goa", TODAY)!, TODAY).find((q) => q.field === "month")
    expect(trip).toMatchObject({ hint: expect.stringMatching(/no verdict and no transport estimate/), skipped: "Skipped: the plan will have no verdict and no transport estimate." })
    const car = intakeQuestions(detectPlan("Can I buy a car?", TODAY)!, TODAY).find((q) => q.field === "month")
    expect(car).toMatchObject({ skipped: "Skipped: the plan will have no verdict." })
  })

  it("leaves other questions to Roma's chat", () => {
    expect(detectPlan("What did I spend last month?", TODAY)).toBeNull()
    expect(detectPlan("How much did my Goa trip cost?", TODAY)).toBeNull()
  })

  it("puts a month without a year in the next twelve months", () => {
    expect(monthIn("in March", TODAY)).toBe("2027-03")
    expect(monthIn("in Dec", TODAY)).toBe("2026-12")
    expect(monthIn("in November", TODAY)).toBe("2026-11")
    expect(monthIn("in May 2028", TODAY)).toBe("2028-05")
  })
})

describe("checking the answers", () => {
  const bike = { kind: "purchase", item: "bike", make: null, model: null, month: null, depositMinor: null } as const

  it("a trade-in of 600000 is used as it is", () => {
    const built = buildPlan(bike, { make: "Royal Enfield", model: "Classic 350", month: "2027-03", depositMinor: "600000" }, new Set(), "INR", TODAY, true)
    expect(built).toEqual({ plan: { ...bike, make: "Royal Enfield", model: "Classic 350", month: "2027-03", depositMinor: 600_000_00 } })
  })

  it("a month typed as text (Safari has no month picker) is read, not refused", () => {
    const built = buildPlan(bike, { month: "March 2027", depositMinor: "6,00,000" }, new Set(), "INR", TODAY)
    expect(built).toMatchObject({ plan: { month: "2027-03", depositMinor: 600_000_00 } })
  })

  it("names the question and the reason for an answer that can't be used", () => {
    expect(buildPlan(bike, { month: "soon", depositMinor: "600000" }, new Set(), "INR", TODAY)).toEqual({
      field: "month",
      error: "When do you want to buy it? “soon” isn't a month. Enter one like March 2027 or 2027-03, or skip it.",
    })
    expect(buildPlan(bike, { depositMinor: "6 lakh" }, new Set(), "INR", TODAY)).toEqual({
      field: "depositMinor",
      error: "Any trade-in or deposit? Enter it in INR as a number, such as 600000, or skip it.",
    })
    expect(buildPlan(bike, { depositMinor: "99999999999999999" }, new Set(), "INR", TODAY)).toMatchObject({ field: "depositMinor", error: expect.stringContaining("Amount is too large.") })
    expect(buildPlan(bike, { month: "2026-10" }, new Set(), "INR", TODAY)).toMatchObject({ field: "month", error: expect.stringContaining("That month has passed") })
  })

  it("a shortlist takes its use and budget; a skipped budget is null (worked out from the records)", () => {
    const draft = detectPlan("which bike should I buy for my office commute?", TODAY)!
    expect(draft).toMatchObject({ item: "bike", make: null, use: "commute" })
    expect(intakeQuestions(draft, TODAY).map((q) => q.field)).toEqual(["budgetMinor", "month", "depositMinor"])
    const built = buildPlan(draft, { budgetMinor: "150000", month: "2027-01" }, new Set(["depositMinor"]), "INR", TODAY)
    expect(built).toEqual({ plan: { kind: "purchase", item: "bike", make: null, model: null, month: "2027-01", depositMinor: null, use: "commute", budgetMinor: 150_000_00 } })
    expect(buildPlan(detectPlan("can I buy a car", TODAY)!, { use: "family" }, new Set(["budgetMinor"]), "INR", TODAY)).toMatchObject({ plan: { use: "family", budgetMinor: null } })
    expect(buildPlan(draft, { budgetMinor: "1.5 lakh" }, new Set(), "INR", TODAY)).toEqual({ field: "budgetMinor", error: "What's your budget? Enter it in INR as a number, such as 600000, or skip it." })
  })

  it("'I already know the model' gives the usual model plan, without the shortlist's fields", () => {
    const draft = detectPlan("which bike should I buy for my office commute?", TODAY)!
    const built = buildPlan(draft, { make: "Honda", model: "Shine", month: "2027-01" }, new Set(), "INR", TODAY, true)
    expect(built).toEqual({ plan: { kind: "purchase", item: "bike", make: "Honda", model: "Shine", month: "2027-01", depositMinor: null } })
  })

  it("a skipped answer is null, whatever was typed", () => {
    expect(buildPlan(bike, { depositMinor: "abc" }, new Set(["depositMinor"]), "INR", TODAY)).toMatchObject({ plan: { depositMinor: null } })
  })
})

describe("parseMonth", () => {
  it("reads the picker's value and typed months", () => {
    expect(parseMonth("2027-03", TODAY)).toBe("2027-03")
    expect(parseMonth("03/2027", TODAY)).toBe("2027-03")
    expect(parseMonth("3-27", TODAY)).toBe("2027-03")
    expect(parseMonth("Mar 2027", TODAY)).toBe("2027-03")
    expect(parseMonth("September, 2027", TODAY)).toBe("2027-09")
    expect(parseMonth("march", TODAY)).toBe("2027-03")
    expect(parseMonth("december", TODAY)).toBe("2026-12")
  })

  it("refuses what isn't a month", () => {
    for (const raw of ["soon", "13/2027", "ma 2027", "2027", ""]) expect(parseMonth(raw, TODAY)).toBeNull()
  })
})
