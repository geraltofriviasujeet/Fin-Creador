import { describe, expect, it } from "vitest"
import { MEASURE_INPUTS } from "./measure.live.test"
import { type PrivateTerms, buildQuery, webLookupInput } from "./query"

const NONE: PrivateTerms = { names: [], phrases: [] }
const trip = { kind: "trip", destination: "Goa", month: "2027-01", nights: 4, travellers: 2, cost_line: "stay" } as const

describe("web lookup queries", () => {
  it("builds a trip query from the template, with no digits", () => {
    expect(buildQuery(trip, NONE, "IN")).toEqual({
      ok: true,
      query: "average hotel price per night in Goa in January in rupees",
      subject: "Goa",
      scope: "domestic",
    })
    const flight = buildQuery({ ...trip, destination: "Thailand", cost_line: "transport" }, NONE, "IN")
    expect(flight).toMatchObject({ ok: true, query: "return flight price from India to Thailand in January", scope: "international" })
  })

  it("asks a domestic trip's priced lookups for rupees; names and visas aren't priced", () => {
    expect(buildQuery({ ...trip, destination: "Chennai", origin: "Delhi", cost_line: "transport" }, NONE, "IN")).toMatchObject({ query: "flight ticket price from Delhi to Chennai in January in rupees" })
    expect(buildQuery({ ...trip, destination: "Chennai", cost_line: "local_travel" }, NONE, "IN")).toMatchObject({ query: "local taxi hire price per day in Chennai in rupees" })
    expect(buildQuery({ ...trip, destination: "Chennai", origin: "Delhi", cost_line: "carriers" }, NONE, "IN")).toMatchObject({ query: "airlines flying from Delhi to Chennai" })
    expect(buildQuery({ ...trip, destination: "Chennai", cost_line: "shopping" }, NONE, "IN")).toMatchObject({ query: "what to buy in Chennai famous local products" })
    expect(buildQuery({ ...trip, destination: "Thailand", cost_line: "food" }, NONE, "IN")).toMatchObject({ query: "average daily food cost per person in Thailand" })
  })

  it("never searches an unlisted place", () => {
    expect(buildQuery({ ...trip, destination: "Meera's farmhouse" }, NONE, "IN")).toEqual({ ok: false, reason: "unlisted_place" })
    expect(buildQuery({ ...trip, destination: "Goa 25000" }, NONE, "IN")).toEqual({ ok: false, reason: "unlisted_place" })
    expect(buildQuery({ ...trip, destination: "₹ Goa" }, NONE, "IN")).toEqual({ ok: false, reason: "unlisted_place" })
  })

  it("looks up budget hotels by name for a budget plan, 4- and 5-star ones otherwise", () => {
    expect(buildQuery({ ...trip, cost_line: "hotels", style: "budget" }, NONE, "IN")).toMatchObject({ ok: true, query: "budget hotels in Goa with prices per night in rupees" })
    expect(buildQuery({ ...trip, cost_line: "hotels", style: "comfort" }, NONE, "IN")).toMatchObject({ ok: true, query: "four star and five star hotels and resorts in Goa price per night in rupees" })
    expect(buildQuery({ ...trip, cost_line: "hotels" }, NONE, "IN")).toMatchObject({ ok: true, query: "four star and five star hotels and resorts in Goa price per night in rupees" })
  })

  it("looks up a visa only for an international trip", () => {
    expect(buildQuery({ ...trip, cost_line: "visa" }, NONE, "IN")).toEqual({ ok: false, reason: "line_not_for_scope" })
  })

  it("refuses a place matching the person's own words", () => {
    expect(buildQuery({ ...trip, destination: "Jordan" }, { names: ["Jordan Rao"], phrases: [] }, "IN")).toEqual({ ok: false, reason: "private" })
    expect(buildQuery({ ...trip, destination: "Jordan" }, { names: ["jordan.rao@example.test"], phrases: [] }, "IN")).toEqual({ ok: false, reason: "private" })
    expect(buildQuery(trip, { names: [], phrases: ["Goa"] }, "IN")).toEqual({ ok: false, reason: "private" })
    // A template word matching a category ("Food") is not the person's.
    expect(buildQuery({ ...trip, cost_line: "food" }, { names: [], phrases: ["Food", "Goa trip savings"] }, "IN")).toMatchObject({ ok: true })
  })

  it("takes a vehicle only from the catalogue, written as listed", () => {
    expect(buildQuery({ kind: "vehicle", vehicle: "car", make: "hyundai", model: "creta", month: "2027-03" }, NONE, "IN")).toEqual({
      ok: true,
      query: "Hyundai Creta on road price in India March",
      subject: "Hyundai Creta",
    })
    expect(buildQuery({ kind: "vehicle", vehicle: "car", make: "Mahindra", model: "XUV700", month: "2027-03" }, NONE, "IN")).toMatchObject({ ok: true })
    expect(buildQuery({ kind: "vehicle", vehicle: "car", make: "Hyundai", model: "Creta 1500000", month: "2027-03" }, NONE, "IN")).toEqual({
      ok: false,
      reason: "unlisted_item",
    })
  })

  it("rejects free text and amounts in the input itself", () => {
    expect(webLookupInput.safeParse({ ...trip, query: "cheap hotels" }).success).toBe(false)
    expect(webLookupInput.safeParse({ ...trip, nights: 45 }).success).toBe(false)
    expect(webLookupInput.safeParse({ ...trip, travellers: 1.5 }).success).toBe(false)
    expect(webLookupInput.safeParse({ ...trip, cost_line: "shopping" }).success).toBe(false)
  })

  it("builds every measurement query", () => {
    for (const input of MEASURE_INPUTS) expect(buildQuery(input, NONE, "IN"), JSON.stringify(input)).toMatchObject({ ok: true })
  })
})
