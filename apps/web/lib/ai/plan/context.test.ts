import { describe, expect, it } from "vitest"
import { aboutPrice, dishesIn, placesIn, shoppingIn } from "./context"

// What a price is for, found in code next to it in its own page text; nothing found, nothing said.

const result = (snippet: string) => ({ title: "Test data", url: "https://pages.example.test/a", snippet })

describe("what a price is for", () => {
  it("names the hotel or the area for a nightly rate, never the destination itself", () => {
    expect(aboutPrice("stay", "The Oberoi Hotel in Nariman Point costs ₹17,969 a night.", "17969", "Mumbai")).toBe("The Oberoi Hotel")
    expect(aboutPrice("stay", "Guest houses in Colaba cost ₹2,500 a night.", "2500", "Mumbai")).toBe("Colaba")
    expect(aboutPrice("stay", "Rooms in Mumbai cost ₹2,500 a night.", "2500", "Mumbai")).toBeUndefined()
  })

  it("names the meal, the mode or the place nearest the price", () => {
    expect(aboutPrice("food", "A thali costs ₹250 while fine dining runs far higher.", "250", null)).toBe("thali")
    expect(aboutPrice("local_travel", "The local train pass is ₹150 a day; an app cab (Uber) is ₹1,200.", "1200", null)).toBe("app cab")
    expect(aboutPrice("local_travel", "The local train pass is ₹150 a day; an app cab (Uber) is ₹1,200.", "150", null)).toBe("local train")
    expect(aboutPrice("sightseeing", "Tickets for Elephanta Caves are ₹600 per person.", "600", null)).toBe("Elephanta Caves")
    expect(aboutPrice("food", "Expect to pay ₹900 a day.", "900", null)).toBeUndefined()
  })
})

describe("what a line mentions", () => {
  it("lists named dishes, well-known places and what a place is known for buying, each once", () => {
    const pages = [result("Try vada pav, pav bhaji and bombil fry. Gateway of India and Marine Drive Point; visit Elephanta Caves. Known for leather goods, silver jewellery and spices.")]
    expect(dishesIn(pages).map((m) => m.name)).toEqual(["vada pav", "pav bhaji", "bombil fry"])
    expect(placesIn(pages).map((m) => m.name)).toEqual(["Gateway of India", "Marine Drive Point", "Elephanta Caves"])
    expect(shoppingIn(pages).map((m) => m.name)).toEqual(["spices", "silver jewellery", "leather goods"])
  })
})
