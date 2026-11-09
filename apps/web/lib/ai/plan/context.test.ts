import { describe, expect, it } from "vitest"
import { aboutPage, aboutPrice, dishesIn, placesIn, shoppingIn, unitAt } from "./context"

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

describe("what a price is for, from its page when its own words don't say", () => {
  it("a taxi firm's page: from its title, else its address", () => {
    expect(aboutPage("local_travel", "Drop Taxi Chennai - One Way Taxi", "https://droptaxi.in/")).toBe("taxi")
    expect(aboutPage("local_travel", "Murugan Travels | Call now", "https://www.murugancabs.com/tariff")).toBe("taxi")
    expect(aboutPage("local_travel", "Tariff", "https://example.test/chennai-auto-rickshaw-fares")).toBe("auto")
    expect(aboutPage("local_travel", "Chennai travel guide", "https://example.test/chennai")).toBeUndefined()
    expect(aboutPage("local_travel", "Cabin stays", "https://cabinstays.example.test/")).toBeUndefined()
  })

  it("a hotel's own page, never a listing of hotels", () => {
    expect(aboutPage("stay", "Hotel Savera, Chennai | Official Site", "https://hotelsavera.example.test/", "Chennai")).toBe("Hotel Savera")
    expect(aboutPage("stay", "The Residency Towers Chennai Hotel - Rooms", "https://example.test/", "Chennai")).toBe("The Residency Towers Chennai Hotel")
    expect(aboutPage("stay", "Hotels in Chennai - Book Now", "https://example.test/", "Chennai")).toBeUndefined()
    expect(aboutPage("stay", "10 Best Hotels in Chennai", "https://example.test/", "Chennai")).toBeUndefined()
    expect(aboutPage("stay", "Chennai Hotels | Deals", "https://example.test/", "Chennai")).toBeUndefined()
    expect(aboutPage("stay", "Chennai Hotel", "https://example.test/", "Chennai")).toBeUndefined()
  })

  it("a food guide, an airline's site, a place or tour named in the title", () => {
    expect(aboutPage("food", "Cost of food in Chennai: a 2026 guide", "https://example.test/")).toBe("food")
    expect(aboutPage("food", "Best thali in Chennai", "https://example.test/")).toBe("thali")
    expect(aboutPage("food", "Chennai on a budget", "https://example.test/chennai-food-prices")).toBe("food")
    expect(aboutPage("food", "Chennai on a budget", "https://example.test/")).toBeUndefined()
    expect(aboutPage("food", "Cost of Living in Chennai 2026 for Families", "https://example.test/")).toBe("food")
    expect(aboutPage("food", "Food prices in India for budget travellers", "https://example.test/")).toBe("food")
    expect(aboutPage("food", "Budget for meals in Chennai", "https://example.test/")).toBe("food")
    expect(aboutPage("transport", "Book flights", "https://www.goindigo.in/")).toBe("IndiGo")
    expect(aboutPage("transport", "Air India Express | Delhi to Chennai", "https://example.test/")).toBe("Air India Express")
    expect(aboutPage("sightseeing", "Fort St George Chennai: timings and entry fee", "https://example.test/")).toBe("Fort St George")
    expect(aboutPage("sightseeing", "Things to do in Chennai", "https://example.test/")).toBeUndefined()
  })
})

describe("the unit written next to a price", () => {
  it("right after it, a person or head skipped", () => {
    expect(unitAt("An app cab costs ₹2,000 per day.", "2000")).toBe("day")
    expect(unitAt("Street food costs ₹800 per person per day.", "800")).toBe("day")
    expect(unitAt("Autos charge ₹18/km in the city.", "18")).toBe("km")
    expect(unitAt("Sedan from ₹1,400 / 4 hrs · 40 km", "1400")).toBe("hour")
    expect(unitAt("Rooms from ₹4,500 a night.", "4500")).toBe("night")
    expect(unitAt("A PG costs ₹7,000 per month.", "7000")).toBe("month")
  })

  it("else in its own table cell or clause just before it", () => {
    const table = "Base fee | Rs 130.00 | | Price per kilometer | Rs 25.00 | | Stand-/Waiting (per hour) | Rs 145.00 |"
    expect(unitAt(table, "130")).toBe("trip")
    expect(unitAt(table, "25")).toBe("km")
    expect(unitAt(table, "145")).toBe("hour")
    expect(unitAt("Sedan from ₹1,400 / 4 hrs · 40 km 8 hrs / 80 km₹2,800 Extra km₹15", "2800")).toBe("day")
    expect(unitAt("Sedan from ₹1,400 / 4 hrs · 40 km 8 hrs / 80 km₹2,800 Extra km₹15", "15")).toBe("km")
    expect(unitAt("You can eat three meals a day for under ₹300 if you choose local places.", "300")).toBe("day")
    expect(unitAt("A thali costs ₹250.", "250")).toBeUndefined()
  })

  it("an outstation rate or an add-on charge is that, whatever follows", () => {
    expect(unitAt("Extra hour₹250 Outstation (min 250 km/day)₹3,750 Outstation extra km₹15", "3750")).toBe("outstation")
    expect(unitAt("Round trips - Driver batta is Rs. 500/- per day", "500")).toBe("add_on")
    expect(unitAt("1 day means 1 calendar day (00:00 hrs to 23:59 hrs) Hill station charges - Rs. 300 for sedan", "300")).toBe("add_on")
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
