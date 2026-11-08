import { describe, expect, it } from "vitest"
import { aboutPrice, dishesIn, placesIn, shoppingIn } from "./context"

// What a price is for, found in code next to it in its own page text; nothing found, nothing said.

const result = (snippet: string) => ({ title: "Test data", url: "https://pages.example.test/a", snippet })

describe("what a price is for", () => {
  it("names the hotel or property for a nightly rate; an area alone isn't one", () => {
    expect(aboutPrice("stay", "The Oberoi Hotel in Nariman Point costs ₹17,969 a night.", "17969")).toBe("The Oberoi Hotel")
    expect(aboutPrice("stay", "Rates at Denissons Beach Resort start at ₹5,375 a night.", "5375")).toBe("Denissons Beach Resort")
    expect(aboutPrice("stay", "Guest houses in Colaba cost ₹2,500 a night.", "2500")).toBeUndefined()
    expect(aboutPrice("stay", "Rooms in Mumbai cost ₹2,500 a night.", "2500")).toBeUndefined()
  })

  it("names the airline for a fare, the longer name first; no airline, nothing", () => {
    expect(aboutPrice("transport", "Air India Express flights from Delhi to Goa cost ₹4,200 one way.", "4200")).toBe("Air India Express")
    expect(aboutPrice("transport", "IndiGo is ₹3,900 while Akasa Air charges ₹5,100.", "5100")).toBe("Akasa Air")
    expect(aboutPrice("transport", "Return flights to Bangkok cost USD 598 on average.", "598")).toBeUndefined()
  })

  it("names the meal, the mode or the place or tour nearest the price", () => {
    expect(aboutPrice("food", "A thali costs ₹250 while fine dining runs far higher.", "250")).toBe("thali")
    expect(aboutPrice("food", "Budget for food at about ₹900 a day.", "900")).toBe("food for a day")
    expect(aboutPrice("food", "Expect to pay ₹900 a day.", "900")).toBeUndefined()
    expect(aboutPrice("local_travel", "The local train pass is ₹150 a day; an app cab (Uber) is ₹1,200.", "1200")).toBe("app cab")
    expect(aboutPrice("local_travel", "The local train pass is ₹150 a day; an app cab (Uber) is ₹1,200.", "150")).toBe("local train")
    expect(aboutPrice("local_travel", "Scooter hire is about ₹400 a day.", "400")).toBe("scooter hire")
    expect(aboutPrice("local_travel", "Budget about ₹400 a day for getting around.", "400")).toBeUndefined()
    expect(aboutPrice("sightseeing", "Tickets for Elephanta Caves are ₹600 per person.", "600")).toBe("Elephanta Caves")
    expect(aboutPrice("sightseeing", "A sunset cruise on the Mandovi costs ₹800 per person.", "800")).toBe("sunset cruise")
    expect(aboutPrice("sightseeing", "Most activities cost ₹800 per person.", "800")).toBeUndefined()
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
