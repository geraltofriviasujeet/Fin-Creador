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

  it("gives a rate to the hotel in its own sentence, never to a neighbour named near it; a budget plan needs no stars", () => {
    const text = "Casa Anjuna Inn charges ₹2,200 a night. Sea Shell Guest Hotel is near the beach."
    const price = { id: "w3", currency: "INR", amount: "2200", scale: "none" as const, value: "2200", source_url: "https://stays.example.test/goa", site: "stays.example.test", title: "Test data", quote: text }
    expect(hotelCandidates([result(text)], [price], "Goa", false).map((h) => [h.name, h.rateId])).toEqual([
      ["Casa Anjuna Inn", "w3"],
      ["Sea Shell Guest Hotel", undefined],
    ])
    expect(hotelCandidates([result(text)], [price], "Goa")).toEqual([])
  })

  it("cuts a sentence's end before a name and drops a name with Cheap in it (seen on a live budget search)", () => {
    const text = "Near Calangute Beach. Moon Light Retreat has rooms. Hotel Arya Niwas Cheap deals. St. Regis Hotel is by the sea."
    expect(hotelCandidates([result(text)], [], "Goa", false).map((h) => h.name)).toEqual(["Moon Light Retreat", "St. Regis Hotel"])
  })

  it("never takes a site's name for a hotel's, and keeps each hotel once", () => {
    const text =
      "Mumbai SHARE Filter By Hotel 5-star. Apply The Leela Palace Hotel is 5-star. Courtyard by Marriott Mumbai Hotel is a 4-star hotel. Mumbai Booking.com Hotel deals on 5-star stays. Taj Mahal Palace Mumbai is a 5-star hotel. The Taj Mahal Palace, a five-star landmark, is by the sea. TAJ MAHAL PALACE is a 5-star icon. Trident Hotel is a 5-star hotel at Nariman Point."
    const found = hotelCandidates([result(text, "https://stays.example.test/mumbai")], [], "Mumbai")
    expect(found.map((h) => h.name)).toEqual(["The Leela Palace Hotel", "Courtyard by Marriott Mumbai Hotel", "Taj Mahal Palace Mumbai", "Trident Hotel"])
  })
})
