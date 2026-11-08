import { describe, expect, it } from "vitest"
import { INR_PER, canConvert, convertDecimal, rateWords } from "./rates"

describe("plan exchange rates", () => {
  it("converts exactly in integers, rounded once to the target's minor units", () => {
    // 152 × 94.1176 = 14,305.8752 → ₹14,305.88
    expect(convertDecimal("152", "USD", "INR")).toBe("14305.88")
    expect(convertDecimal("2200", "THB", "INR")).toBe("6168.8")
    expect(convertDecimal("1000", "NPR", "INR")).toBe("625")
    // Half away from zero: 0.04 × 0.625 is 2.5 paise, rounded up.
    expect(convertDecimal("0.04", "NPR", "INR")).toBe("0.03")
    expect(convertDecimal("4500", "INR", "INR")).toBe("4500")
  })

  it("goes through rupees between two other currencies", () => {
    // ₹9,411.76 is USD 100.00; 1 EUR = ₹105.031 is USD 1.12 (rounded to cents).
    expect(convertDecimal("9411.76", "INR", "USD")).toBe("100")
    expect(convertDecimal("1", "EUR", "USD")).toBe("1.12")
  })

  it("never converts a currency without a rate", () => {
    expect(canConvert("JPY", "INR")).toBe(false)
    expect(convertDecimal("5000", "JPY", "INR")).toBeNull()
    expect(convertDecimal("5000", "INR", "JPY")).toBeNull()
  })

  it("has a rate for each currency a plan converts, and states them", () => {
    expect(Object.keys(INR_PER).sort()).toEqual(["AED", "EUR", "GBP", "INR", "LKR", "MYR", "NPR", "SGD", "THB", "USD"])
    for (const r of Object.values(INR_PER)) expect(r).toMatch(/^\d+(\.\d+)?$/)
    expect(rateWords(["USD", "INR", "JPY"])).toEqual(["1 USD = INR 94.1176"])
  })
})
