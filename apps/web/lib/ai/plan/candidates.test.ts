import { describe, expect, it } from "vitest"
import type { SearchResult } from "../search/types"
import { factsIn, modelCandidates } from "./candidates"
import { PURCHASE_SANITY } from "./run"

// Model candidates (10.9 follow-up): a listed make and model with a price on its own card,
// found in code; a neighbour's price, an EMI or an implausible price is never one.

const page = (content: string, url = "https://listing.example.test/"): SearchResult => ({ title: "Test listing", url, snippet: "Test data.", content })
const bikes = (content: string) => modelCandidates([page(content)], "bike", PURCHASE_SANITY.bike)
const cars = (content: string) => modelCandidates([page(content)], "car", PURCHASE_SANITY.car)

describe("model candidates", () => {
  it("pairs each listed model with the first price on its own card", () => {
    const out = bikes("Hero Splendor Plus Rs. 93,169 Onwards 97.2 cc, 70 kmpl. TVS Radeon Rs. 70,303 109.7 cc, 73.68 kmpl commuter.")
    expect(out.candidates.map((c) => [c.id, c.make, c.model, c.low, c.high, c.bound])).toEqual([
      ["m1", "Hero", "Splendor Plus", "93169", "93169", "from"],
      ["m2", "TVS", "Radeon", "70303", "70303", undefined],
    ])
    expect(out.candidates[0]!.site).toBe("listing.example.test")
  })

  it("never borrows the next card's price for a model whose card has none", () => {
    const out = bikes("Bajaj Platina 115.45 cc, 70 kmpl. TVS Radeon Rs. 70,303 109.7 cc.")
    expect(out.candidates.map((c) => c.model)).toEqual(["Radeon"])
    expect(out.drops.unpriced).toBe(1)
    expect(out.named).toBe(2)
  })

  it("skips a monthly instalment and takes the price after it on the same card", () => {
    const out = bikes("Honda Shine 100 EMI from ₹2,500 per month ₹68,000 98.98 cc.")
    expect(out.candidates.map((c) => [c.model, c.low])).toEqual([["Shine 100", "68000"]])
    // An EMI alone is never the price.
    expect(bikes("Honda Shine EMI ₹2,500/month only.").drops).toMatchObject({ monthly: 1 })
  })

  it("drops a price outside the purchase's plausible range: a ₹30,500 car never reaches a shortlist", () => {
    const out = cars("Maruti Suzuki Swift seat covers ₹30,500. Tata Punch Rs. 5.75 - 10.77 Lakh ex-showroom Petrol SUV 5 seater.")
    expect(out.candidates.map((c) => c.model)).toEqual(["Punch"])
    expect(out.drops.outOfRange).toBe(1)
    // Both ends of a range must be inside it.
    expect(cars("Tata Punch Rs. 1.5 - 10.77 Lakh.").candidates).toEqual([])
  })

  it("reads a lakh range in full and the card's own facts, ex-showroom only when it says so", () => {
    const [punch, creta] = cars("Tata Punch Rs. 5.75 - 10.77 Lakh ex-showroom Petrol SUV 5 seater. Hyundai Creta Rs. 10.91 - 20.46 Lakh SUV.").candidates
    expect(punch).toMatchObject({ low: "575000", high: "1077000", exShowroom: true, facts: ["Petrol", "5 seats", "SUV"] })
    expect(creta).toMatchObject({ low: "1091000", high: "2046000", exShowroom: false, facts: ["SUV"] })
  })

  it("matches other ways a make or model is written, and keeps each model once", () => {
    const out = cars("Maruti Swift Rs. 6.49 Lakh. Mercedes Benz GLA Rs. 50.5 Lakh. Maruti Suzuki Swift Rs. 6.99 Lakh.")
    expect(out.candidates.map((c) => [c.make, c.model, c.low])).toEqual([
      ["Maruti Suzuki", "Swift", "649000"],
      ["Mercedes-Benz", "GLA", "5050000"],
    ])
    expect(bikes("Yamaha FZ X Rs. 1,43,732").candidates[0]).toMatchObject({ make: "Yamaha", model: "FZ-X" })
  })

  it("takes the longer model, never a shorter one inside it", () => {
    expect(bikes("Honda Activa 125 Rs. 94,000").candidates.map((c) => c.model)).toEqual(["Activa 125"])
  })

  it("prices in another currency aren't used", () => {
    expect(bikes("KTM 390 Duke $3,500 in the US.").drops).toMatchObject({ otherCurrency: 1 })
  })

  it("a model priced on a later page is kept, not counted as dropped", () => {
    const out = modelCandidates([page("Hero Glamour, a 125 cc commuter.", "https://a.example.test/"), page("Hero Glamour Rs. 1,06,374", "https://b.example.test/")], "bike", PURCHASE_SANITY.bike)
    expect(out.candidates.map((c) => c.site)).toEqual(["b.example.test"])
    expect(out.drops.unpriced).toBe(0)
  })

  it("reads facts without cutting a decimal's digits", () => {
    expect(factsIn("162.71 cc, 50 kmpl naked", "bike")).toEqual(["162.71 cc", "50 kmpl", "naked"])
    expect(factsIn("Electric scooter with 150 km range", "bike")).toEqual(["150 km range", "Electric", "scooter"])
  })
})
