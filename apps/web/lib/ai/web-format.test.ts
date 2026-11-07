import { describe, expect, it } from "vitest"
import { groupDigits, webPrice, webTotal } from "./web-format"

describe("web estimates on screen", () => {
  it("writes a price as found, in its own currency", () => {
    expect(webPrice({ amount: "7.4", scale: "lakh", currency: "INR", per: "total" })).toBe("INR 7.4 Lakh")
    expect(webPrice({ amount: "60", scale: "none", currency: "GBP", per: "night" })).toBe("GBP 60 a night")
    expect(webPrice({ amount: "18000", scale: "none", currency: "INR", per: "person" })).toBe("INR 18,000 a person")
  })

  it("groups digits the Indian way for rupees only", () => {
    expect(groupDigits("1234567.5", "INR")).toBe("12,34,567.5")
    expect(groupDigits("1234567.5", "USD")).toBe("1,234,567.5")
  })

  it("shows a range when the prices ranged", () => {
    expect(webTotal({ currency: "INR", low: "30000", high: "36002" })).toBe("INR 30,000 to 36,002")
    expect(webTotal({ currency: "INR", low: "54000", high: "54000" })).toBe("INR 54,000")
  })
})
