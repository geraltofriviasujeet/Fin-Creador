import { describe, expect, it } from "vitest"
import { allowedNumbers, checkAnswer, normalizeNumber, numbersIn } from "./output"
import type { Figure } from "./tools/types"

const figures: Figure[] = [
  { label: "Spent", kind: "money", minor: 1234550, currency: "INR" }, // ₹12,345.50
  { label: "Refunds", kind: "money", minor: 50000, currency: "INR" }, // ₹500
  { label: "Expenses", kind: "count", value: 17 },
]
const allowed = allowedNumbers(figures, ["2026-10-01", "2026-10-31", "2026-11-05"])

describe("numbers in an answer", () => {
  it("reads grouped, Indian-grouped and decimal numbers", () => {
    expect(numbersIn("₹12,345.50 and ₹1,23,456 and 17, then 3.")).toEqual(["12345.5", "123456", "17", "3"])
    expect(normalizeNumber("0012,000.00")).toBe("12000")
  })
})

describe("the figure check", () => {
  it("passes an answer whose every number comes from the tools or the period", () => {
    const text = "You spent ₹12,345.50 from 1 October to 31 October 2026, across 17 expenses. Refunds: ₹500."
    expect(checkAnswer(text, allowed)).toEqual({ ok: true, text })
    expect(checkAnswer("You spent ₹12,345.50 between 2026-10-01 and 2026-10-31.", allowed).ok).toBe(true)
  })

  it("refuses the whole answer when one number can't be verified, without changing it", () => {
    expect(checkAnswer("You spent ₹12,345.50, about ₹400 a day.", allowed)).toEqual({ ok: false, reason: "unverified", unmatched: ["400"] })
  })

  it("refuses a rounded figure", () => {
    expect(checkAnswer("You spent about ₹12,346 last month.", allowed)).toMatchObject({ ok: false, reason: "unverified" })
    expect(checkAnswer("You spent ₹12.3k last month.", allowed)).toMatchObject({ ok: false, reason: "unverified" })
  })

  it("refuses a number when no tool ran", () => {
    expect(checkAnswer("You spent ₹900.", allowedNumbers([], ["2026-11-05"]))).toMatchObject({ ok: false, reason: "unverified" })
  })

  it("passes an answer with no numbers", () => {
    expect(checkAnswer("I can't see your investments yet.", allowed).ok).toBe(true)
  })

  it("refuses praise openers and empty or oversized answers", () => {
    expect(checkAnswer("Great question! You spent ₹500.", allowed)).toEqual({ ok: false, reason: "tone" })
    expect(checkAnswer("Good news: you spent ₹500.", allowed)).toEqual({ ok: false, reason: "tone" })
    expect(checkAnswer("   ", allowed)).toEqual({ ok: false, reason: "invalid" })
    expect(checkAnswer("x".repeat(2001), allowed)).toEqual({ ok: false, reason: "invalid" })
  })

  it("treats a negative figure (refunds above spending) by its size", () => {
    const negative = allowedNumbers([{ label: "Spent", kind: "money", minor: -25000, currency: "INR" }], [])
    expect(checkAnswer("Refunds were larger: −₹250.", negative).ok).toBe(true)
  })
})
