import { describe, expect, it } from "vitest"
import { UNKNOWN_AMOUNT, figureId, fillPlaceholders, webAmounts, withoutPlaceholders } from "./placeholders"

describe("amounts by placeholder", () => {
  it("makes an id from a figure's label, and a different one for a repeat", () => {
    const taken = new Map<string, string>()
    expect(figureId("Trip estimate", taken)).toBe("trip_estimate")
    taken.set("fig:trip_estimate", "₹54,000")
    expect(figureId("Trip estimate", taken)).toBe("trip_estimate_2")
    expect(figureId("Travel run 2026-03-03 to 2026-03-07: Travel category", taken)).toBe("travel_run_2026_03_03_to_2026_03_07_travel_categ")
    expect(figureId("₹", taken)).toBe("figure")
  })

  it("fills in known placeholders, drops a currency sign before one, and marks unknown ones left out", () => {
    const amounts = new Map([
      ["fig:trip_estimate", "₹54,000"],
      ["web:3", "INR 4,500"],
    ])
    expect(fillPlaceholders("About ₹{fig:trip_estimate}; hotels {web:3} INR a night, flights Rs. {web:9}.", amounts)).toEqual({
      text: `About ₹54,000; hotels INR 4,500 a night, flights ${UNKNOWN_AMOUNT}.`,
      unknown: ["web:9"],
    })
    // Not a placeholder: left as written (and the figure check reads it).
    expect(fillPlaceholders("{fig:Trip Estimate} {total}", amounts).text).toBe("{fig:Trip Estimate} {total}")
  })

  it("blanks placeholders for the checks, so their digits are never read as figures", () => {
    expect(withoutPlaceholders("₹{fig:run_2026_03}, {web:12}")).toBe(" ,  ")
  })

  it("gives the kept web prices and totals their placeholders", () => {
    const block = {
      figures: [{ id: "w3", label: "Hotel", amount: "4500", scale: "none", value: "4500", currency: "INR", per: "night", site: "example.test", url: "https://example.test/" }],
      totals: [{ currency: "INR", lines: 1, costLines: ["stay"], low: "18000", high: "36000" }],
    }
    expect([...webAmounts(block)]).toEqual([
      ["web:3", "INR 4,500"],
      ["web:total_inr", "INR 18,000 to 36,000"],
    ])
    expect(webAmounts(undefined).size).toBe(0)
  })
})
