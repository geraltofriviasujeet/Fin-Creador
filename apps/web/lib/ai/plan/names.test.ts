import { describe, expect, it } from "vitest"
import { carrierCandidates, hotelCandidates } from "./names"

// Names are found in code in the pages retrieved, never typed by the model.

const result = (snippet: string, url = "https://stays.example.test/goa") => ({ title: "Test data", url, snippet })

describe("names found in the results", () => {
  it("finds carriers on the list only, each once, the longer name first", () => {
    const found = carrierCandidates([result("Air India Express and IndiGo fly here; Air India too. Example Airways and Air India Express again.")])
    expect(found.map((c) => [c.id, c.name])).toEqual([
      ["c1", "Air India Express"],
      ["c2", "Air India"],
      ["c3", "IndiGo"],
    ])
    expect(found[0]).toMatchObject({ site: "stays.example.test", url: "https://stays.example.test/goa" })
  })

  it("finds a hotel only with a 4- or 5-star mention near it, and never a generic phrase", () => {
    const text =
      "Top Hotels and Best Resorts of the coast. The Leela Palace Goa is a five-star resort. Sea Breeze Inn is a guest house far down the coast with nothing else said about it at all for quite a long stretch of text here."
    const found = hotelCandidates([result(text)], [])
    expect(found.map((h) => [h.name, h.stars])).toEqual([["The Leela Palace Goa", 5]])
  })

  it("attaches a nightly rate only from a price whose own quote names the hotel", () => {
    const text = "Novotel Goa Resort & Spa, a 4-star hotel, costs ₹9,500 per night."
    const price = { id: "w7", currency: "INR", amount: "9500", scale: "none" as const, value: "9500", source_url: "https://stays.example.test/goa", site: "stays.example.test", title: "Test data", quote: text }
    expect(hotelCandidates([result(text)], [price])[0]).toMatchObject({ name: "Novotel Goa Resort & Spa", stars: 4, rateId: "w7" })
    expect(hotelCandidates([result(text)], [{ ...price, quote: "Rooms cost ₹9,500 per night." }])[0]!.rateId).toBeUndefined()
  })
})
