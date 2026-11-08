import { describe, expect, it } from "vitest"
import { goalFormSchema } from "@fin-creador/schemas"
import { goalFromPlan, targetDateOf } from "./goal"
import { type CheckedPlan, type PlanLine, checkedPlanSchema } from "./types"

const TODAY = "2026-11-08"
const web = (line: PlanLine["line"], low: string, high: string, bound?: "at_least"): PlanLine => ({
  line,
  from: "web",
  amounts: [{ currency: "INR", low, high, ...(bound ? { bound } : {}) }],
  how: "Listed.",
  prices: [],
  pages: [],
})
const none = (line: PlanLine["line"]): PlanLine => ({ line, from: "none", amounts: [], how: "No estimate.", prices: [], pages: [] })

function plan(over: Partial<CheckedPlan>): CheckedPlan {
  return checkedPlanSchema.parse({
    v: 1,
    kind: "trip",
    intake: { title: "Plan: trip to Goa", fields: [] },
    lines: [],
    saved: null,
    carriers: null,
    hotels: null,
    verdicts: { totals: [], records: { verdict: "Yes.", summary: "" }, web: { verdict: "Yes.", summary: "" } },
    changes: [],
    assumptions: [],
    sources: [],
    ...over,
  })
}

/** The prefill goes through the same form schema the server saves with. */
const saved = (values: Record<string, string>) => goalFormSchema({ currency: "INR", today: TODAY }).safeParse({ ...values, goalId: "", idempotencyKey: "00000000-0000-4000-8000-000000000001" })

describe("goalFromPlan", () => {
  it("a trip: lines into the trip goal's cost lines, the higher end, the month's first day", () => {
    const p = plan({
      intake: {
        title: "Plan: trip from Delhi to Goa in January 2027",
        fields: [],
        request: { kind: "trip", destination: "Goa", origin: "Delhi", month: "2027-01", nights: 4, travellers: 2, style: "comfort" },
      },
      lines: [web("transport", "9000", "14000"), web("stay", "20000", "32000"), web("food", "6000", "6000", "at_least"), web("local_travel", "2000", "3000"), web("sightseeing", "1000", "1500"), none("shopping"), web("buffer", "3800", "5650")],
      verdicts: { totals: [{ currency: "INR", low: "41800", high: "62150" }], records: { verdict: "Yes.", summary: "" }, web: { verdict: "Yes.", summary: "" } },
    })
    const { values, notes } = goalFromPlan(p, { currency: "INR", today: TODAY })
    expect(values).toMatchObject({
      type: "trip",
      name: "Trip to Goa",
      targetDate: "2027-01-01",
      scope: "domestic",
      place: "Goa",
      people: "2",
      days: "5",
      stay: "hotel",
      travelMode: "",
      cost_transport: "17000",
      cost_stay: "32000",
      cost_food: "6000",
      cost_activities: "1500",
      cost_buffer: "5650",
    })
    expect(notes.join(" ")).toContain("Local travel is added to Transport")
    // The person still chooses how they travel; with that, the form saves the plan's total.
    const parsed = saved({ ...values, travelMode: "flight" })
    expect(parsed.success && parsed.data.targetMinor).toBe(62_150_00)
  })

  it("a city that isn't a state is left for the person to choose", () => {
    const p = plan({ intake: { title: "Plan", fields: [], request: { kind: "trip", destination: "Chennai", origin: null, month: null, nights: null, travellers: null, style: "budget" } } })
    const { values, notes } = goalFromPlan(p, { currency: "INR", today: TODAY })
    expect(values).toMatchObject({ place: "", scope: "domestic", targetDate: "", stay: "" })
    expect(notes.join(" ")).toContain("Choose the state for Chennai")
  })

  it("a bike: make, model, price and extras; the trade-in as already saved", () => {
    const p = plan({
      kind: "purchase",
      intake: { title: "Plan", fields: [], request: { kind: "purchase", item: "bike", make: "Royal Enfield", model: "Classic 350", month: "2027-03", depositMinor: 6_000_000_00 } },
      lines: [web("price", "190000", "230000"), web("extras", "12000", "15000")],
    })
    const { values, notes } = goalFromPlan(p, { currency: "INR", today: TODAY })
    expect(values).toMatchObject({ type: "vehicle", name: "Buy Royal Enfield Classic 350", vehicle: "bike", condition: "new", make: "Royal Enfield", model: "Classic 350", price: "230000", extras: "15000", saved: "6000000", targetDate: "2027-03-01", payment: "cash" })
    expect(notes.join(" ")).toContain("trade-in or deposit is filled in as already saved")
    const parsed = saved(values)
    expect(parsed.success && [parsed.data.targetMinor, parsed.data.savedMinor]).toEqual([245_000_00, 6_000_000_00])
  })

  it("a vehicle without a model asks for one; a line without an estimate stays empty", () => {
    const p = plan({ kind: "purchase", intake: { title: "Plan", fields: [], request: { kind: "purchase", item: "car", make: null, model: null, month: null, depositMinor: null } }, lines: [none("price"), none("extras")] })
    const { values, notes } = goalFromPlan(p, { currency: "INR", today: TODAY })
    expect(values).toMatchObject({ type: "vehicle", name: "Buy a car", model: "", price: "", extras: "", saved: "" })
    expect(notes.join(" ")).toMatch(/Enter the model.*2 lines have no estimate|2 lines have no estimate.*Enter the model/)
  })

  it("an older plan without its answers: no month or deposit, and says so", () => {
    const p = plan({ kind: "purchase", intake: { title: "Plan: buying a house", fields: [{ label: "Buying", value: "house" }] }, lines: [none("price"), none("extras")] })
    const { values, notes } = goalFromPlan(p, { currency: "INR", today: TODAY })
    expect(values).toMatchObject({ type: "house", name: "Buy a house", targetDate: "", saved: "", city: "" })
    expect(notes.join(" ")).toContain("made before plans kept their answers")
  })

  it("figures in another currency aren't filled in", () => {
    const p = plan({ lines: [{ ...web("stay", "100", "150"), amounts: [{ currency: "USD", low: "100", high: "150" }] }], verdicts: { totals: [{ currency: "USD", low: "100", high: "150" }], records: { verdict: "", summary: "" }, web: { verdict: "", summary: "" } } })
    const { values, notes } = goalFromPlan(p, { currency: "INR", today: TODAY })
    expect(values.cost_stay).toBeUndefined()
    expect(notes[0]).toContain("USD")
  })
})

describe("targetDateOf", () => {
  it("the month's first day, never before today", () => {
    expect(targetDateOf("2027-01", TODAY)).toBe("2027-01-01")
    expect(targetDateOf("2026-11", TODAY)).toBe(TODAY)
    expect(targetDateOf(null, TODAY)).toBe("")
  })
})
