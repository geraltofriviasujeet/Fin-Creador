import { describe, expect, it } from "vitest"
import { detectPlan, intakeQuestions, monthIn } from "./intake"
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

  it("asks make and model for a vehicle the question doesn't name, and neither for a house", () => {
    expect(intakeQuestions(detectPlan("Can I afford a bike?", TODAY)!, TODAY).map((q) => q.field)).toEqual(["make", "model", "month", "depositMinor"])
    expect(intakeQuestions(detectPlan("Can I buy a house in March 2028?", TODAY)!, TODAY).map((q) => q.field)).toEqual(["depositMinor"])
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
