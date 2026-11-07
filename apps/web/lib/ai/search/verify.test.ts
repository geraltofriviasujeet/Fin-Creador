import { describe, expect, it } from "vitest"
import type { SearchResult } from "./types"
import { priceCandidates, pricesIn, scaleUp, verifyWebFigure, type WebFigureInput, webFigureInput } from "./verify"

// Shapes from the snippet measurement (2026-11-06), with test data.
const results: SearchResult[] = [
  {
    title: "Test data: car prices",
    url: "https://cars.example.test/nexon",
    snippet: "Test data. The car is priced from ₹7.40 Lakh to ₹14.52 Lakh (ex-showroom).",
  },
  {
    title: "Test data: hotels",
    url: "https://www.hotels.example.test/leh",
    snippet: "Test data. The average price of a 4-star hotel is currently around £60 per night.",
    content: "Test data. Long page. Return flights average around ₹ 15,216 in January.",
  },
]

const figure = (f: Partial<WebFigureInput>): WebFigureInput =>
  webFigureInput.parse({
    label: "4-star hotel, a night",
    amount: "60",
    currency: "GBP",
    per: "night",
    source_url: "https://www.hotels.example.test/leh",
    quote: "around £60 per night",
    ...f,
  })

describe("prices in text", () => {
  it("reads amounts next to a currency sign or code, with any scale word", () => {
    expect(pricesIn("from ₹7.40 Lakh to ₹14.52 Lakh")).toEqual([
      { currency: "INR", amount: "7.4", scale: "lakh" },
      { currency: "INR", amount: "14.52", scale: "lakh" },
    ])
    expect(pricesIn("Rs 55,000 off")).toEqual([{ currency: "INR", amount: "55000", scale: "none" }])
    expect(pricesIn("about 1,200 baht")).toEqual([{ currency: "THB", amount: "1200", scale: "none" }])
  })

  it.each([
    ["₹7.40 Lakh", "7.4", "lakh", "740000"],
    ["₹7.40 lakhs", "7.4", "lakh", "740000"],
    ["Rs 7.4 lac", "7.4", "lakh", "740000"],
    ["₹7.4L", "7.4", "lakh", "740000"],
    ["₹7.4 L onwards", "7.4", "lakh", "740000"],
    ["₹1.25 Crore", "1.25", "crore", "12500000"],
    ["₹1.25 crores", "1.25", "crore", "12500000"],
    ["₹1.25 Cr", "1.25", "crore", "12500000"],
    ["₹1.25Cr.", "1.25", "crore", "12500000"],
    ["₹45K", "45", "thousand", "45000"],
    ["₹4.5k a night", "4.5", "thousand", "4500"],
  ] as const)("reads the Indian scale in %s and works out the full value in code", (text, amount, scale, value) => {
    expect(pricesIn(text)).toEqual([{ currency: "INR", amount, scale }])
    const result: SearchResult = { title: "Test data", url: "https://scale.example.test/", snippet: `Test data. From ${text}.` }
    const reported = { label: "Price", amount, currency: "INR", per: "total", source_url: result.url, quote: text } as const
    expect(verifyWebFigure(figure({ ...reported, scale }), [result])).toMatchObject({ ok: true, figure: { value } })
    // Reported without its scale, the same words don't state it.
    expect(verifyWebFigure(figure(reported), [result])).toEqual({ ok: false, reason: "amount_not_in_quote" })
  })

  it("doesn't take a word that only starts like a scale", () => {
    expect(pricesIn("₹500 lunch")).toEqual([{ currency: "INR", amount: "500", scale: "none" }])
    expect(pricesIn("₹500 crowd")).toEqual([{ currency: "INR", amount: "500", scale: "none" }])
  })

  it("doesn't read another currency's mark as its own, or a plain number as a price", () => {
    expect(pricesIn("direct C$ 337").map((p) => p.currency)).toEqual(["CAD"])
    expect(pricesIn("4 hours 45 minutes, 43 hotels")).toEqual([])
  })

  it("scales exactly, without floating point", () => {
    expect(scaleUp("7.4", 5)).toBe("740000")
    expect(scaleUp("14.52", 5)).toBe("1452000")
    expect(scaleUp("1.234567", 3)).toBe("1234.567")
    expect(scaleUp("60", 0)).toBe("60")
  })
})

describe("web figure check", () => {
  it("keeps a figure its own result states, with the site's name", () => {
    expect(verifyWebFigure(figure({}), results)).toMatchObject({ ok: true, figure: { value: "60", site: "hotels.example.test" } })
  })

  it("keeps a figure found in the page text, not only the snippet", () => {
    const flights = figure({ amount: "15,216", currency: "INR", per: "person", quote: "average around ₹ 15,216 in January" })
    expect(verifyWebFigure(flights, results)).toMatchObject({ ok: true, figure: { amount: "15216", value: "15216" } })
  })

  it("works out a Lakh price in code, and refuses one reported without its scale", () => {
    const car = { amount: "7.40", currency: "INR", per: "total", source_url: "https://cars.example.test/nexon", quote: "priced from ₹7.40 Lakh" } as const
    expect(verifyWebFigure(figure({ ...car, scale: "lakh" }), results)).toMatchObject({ ok: true, figure: { value: "740000" } })
    expect(verifyWebFigure(figure(car), results)).toEqual({ ok: false, reason: "amount_not_in_quote" })
  })

  it("drops a figure from a URL that wasn't one of this question's results", () => {
    expect(verifyWebFigure(figure({ source_url: "https://elsewhere.example.test/leh" }), results)).toEqual({ ok: false, reason: "unknown_url" })
  })

  it("drops a quote that isn't on the page, or an amount the quote doesn't state", () => {
    expect(verifyWebFigure(figure({ quote: "around £45 per night" }), results)).toEqual({ ok: false, reason: "quote_not_found" })
    expect(verifyWebFigure(figure({ amount: "61" }), results)).toEqual({ ok: false, reason: "amount_not_in_quote" })
    expect(verifyWebFigure(figure({ currency: "USD" }), results)).toEqual({ ok: false, reason: "amount_not_in_quote" })
  })

  it("accepts only digits as an amount", () => {
    expect(webFigureInput.safeParse({ ...figure({}), amount: "£60" }).success).toBe(false)
    expect(webFigureInput.safeParse({ ...figure({}), amount: "about 60" }).success).toBe(false)
  })
})

describe("prices found in code (priceCandidates)", () => {
  const result = (snippet: string, content?: string) => ({ title: "Test data", url: "https://www.cars.example.test/creta", snippet, ...(content ? { content } : {}) })

  it("finds amount, currency, scale and the words around it, case kept", () => {
    const [c] = priceCandidates(result("Test data. The Creta's ex-showroom price starts at ₹11.11 Lakh in Delhi for the base trim."))
    expect(c).toMatchObject({ currency: "INR", amount: "11.11", scale: "lakh", value: "1111000", site: "cars.example.test", source_url: "https://www.cars.example.test/creta" })
    expect(c!.quote).toContain("starts at ₹11.11 Lakh in Delhi")
  })

  it("finds each amount once, even where two marks fit (Rs. and Rs)", () => {
    expect(priceCandidates(result("Test data. Rooms Rs. 2,500 a night; suites Rs. 2,500 on weekdays; USD 40 abroad.")).map((c) => [c.currency, c.amount])).toEqual([
      ["INR", "2500"],
      ["USD", "40"],
    ])
  })

  it("reads the snippet, then the page text, up to the limit", () => {
    const r = result("Test data. From ₹900.", "Test data. Then ₹1,200, ₹1,500, ₹1,800 and ₹2,100.")
    expect(priceCandidates(r).map((c) => c.amount)).toEqual(["900", "1200", "1500", "1800"])
    expect(priceCandidates(r, 2).map((c) => c.amount)).toEqual(["900", "1200"])
  })

  it("gives a quote the backstop accepts, so a picked candidate is never dropped for its amount", () => {
    const r = result("Test data. Budget stays from about ₹1,499/night, and premium resorts near ₹12,000 per night in December.")
    for (const c of priceCandidates(r)) {
      expect(verifyWebFigure({ label: "x", per: "night", ...c }, [r])).toMatchObject({ ok: true, figure: { value: c.value } })
    }
  })

  it("finds nothing where no amount sits next to a currency", () => {
    expect(priceCandidates(result("Test data. Rated 4.5 by 1,200 guests, 3 km from the beach."))).toEqual([])
  })
})
