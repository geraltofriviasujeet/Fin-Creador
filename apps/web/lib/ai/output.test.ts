import { describe, expect, it } from "vitest"
import { allowedNumbers, checkAnswer, literalStrings, normalizeNumber, numbersIn } from "./output"
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

describe("numbered lists (10.5)", () => {
  it("doesn't read a list marker at the start of a line as a number", () => {
    expect(numbersIn("I need:\n\n1. Which month?\n2) How many nights?\n  3. How many travellers?")).toEqual([])
  })
  it("still reads every figure on a list line, and numbers that aren't markers", () => {
    expect(numbersIn("1. ₹5,000 on food\nUp 1. 2 people")).toEqual(["5000", "1", "2"])
    expect(numbersIn("1.5 lakh")).toEqual(["1.5"])
    expect(checkAnswer("1. You spent ₹9,000.", allowedNumbers([], []))).toEqual({ ok: false, reason: "unverified", unmatched: ["9000"] })
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

describe("rates (10.2)", () => {
  it("allows a rate exactly as the tool wrote it, and nothing else", () => {
    const rates = allowedNumbers([{ label: "Savings rate", kind: "percent", bps: 2350 }, { label: "Limit used", kind: "percent", bps: -1205 }], [])
    expect(checkAnswer("You saved 23.5% of your income; last time it was -12.1%.", rates)).toMatchObject({ ok: true })
    expect(checkAnswer("You saved 23.50% of your income.", rates)).toMatchObject({ ok: true })
    expect(checkAnswer("You saved 24% of your income.", rates)).toMatchObject({ ok: false, reason: "unverified", unmatched: ["24"] })
    expect(checkAnswer("You saved 2350 basis points.", rates)).toMatchObject({ ok: false, reason: "unverified" })
  })
})


describe("names a tool returned", () => {
  const data = { goal: "Car 2027", categories: [{ category: "Rent 2BHK", spent: "₹12,345.50" }], count: 3, months: "6" }

  it("collects strings with a digit and a letter, not bare numbers", () => {
    expect(literalStrings(data)).toEqual(["Car 2027", "Rent 2BHK"])
  })

  it("does not read digits inside a goal or category name as figures", () => {
    const literals = literalStrings(data)
    expect(checkAnswer("No. Car 2027 needs ₹500 more a month.", allowed, literals)).toEqual({ ok: true, text: "No. Car 2027 needs ₹500 more a month." })
    expect(checkAnswer("You spent ₹12,345.50 on rent 2bhk.", allowed, literals).ok).toBe(true)
  })

  it("still refuses the same digits outside the name", () => {
    const literals = literalStrings(data)
    expect(checkAnswer("Car 2027 by 2027.", allowed, literals)).toMatchObject({ ok: false, reason: "unverified", unmatched: ["2027"] })
    expect(checkAnswer("Rent 2BHK, 2 rooms.", allowed, literals)).toMatchObject({ ok: false, unmatched: ["2"] })
  })

  it("without the tool's strings, the name's digits are refused", () => {
    expect(checkAnswer("Car 2027 needs ₹500.", allowed)).toMatchObject({ ok: false, unmatched: ["2027"] })
  })
})
