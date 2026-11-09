import type { SearchProvider, SearchResult } from "./types"

// The mock search provider: every automated test and the E2E server use it, so no test ever
// spends a credit. Recorded results, labelled as test data; the same results for any query
// unless a test passes its own script. Each price says what it is for (a hotel, an airline),
// as a plan needs (10.9).

export type MockSearchScript = (query: string) => SearchResult[] | Promise<SearchResult[]>

export const MOCK_RESULTS: SearchResult[] = [
  {
    title: "Test data: hotel prices",
    url: "https://example.test/hotels",
    snippet: "Test data. Mid-range hotels such as the Sea Breeze Hotel cost about ₹4,500 per night in this season.",
  },
  {
    title: "Test data: flight prices",
    url: "https://example.test/flights",
    snippet: "Test data. Return flights on IndiGo from about ₹18,000 per person.",
    content: "Test data. Return flights on IndiGo from about ₹18,000 per person; budget carriers sometimes lower.",
  },
]

/**
 * A listing page for a model shortlist (10.9 follow-up), with makes and models from the app's
 * list: two priced cards, one with no price, an EMI that must not be read as a price, and a
 * car-sized accessory price that is implausible for a car.
 */
export const MOCK_MODEL_RESULTS: SearchResult[] = [
  {
    title: "Test data: bike price list",
    url: "https://example.test/bikes",
    snippet: "Test data. Bike price list.",
    content:
      "Test data. Hero Splendor Plus Rs. 93,169 Onwards 97.2 cc, 70 kmpl commuter. Honda Shine 100 EMI from ₹2,500 per month ₹68,000 98.98 cc, 65 kmpl. " +
      "Bajaj Platina 115.45 cc, 70 kmpl. TVS Radeon Rs. 70,303 109.7 cc, 73.68 kmpl.",
  },
  {
    title: "Test data: car price list",
    url: "https://example.test/cars",
    snippet: "Test data. Car price list.",
    content: "Test data. Tata Punch Rs. 5.75 - 10.77 Lakh ex-showroom Petrol SUV 5 seater. Maruti Suzuki Swift seat covers ₹30,500. Hyundai Creta Rs. 10.91 - 20.46 Lakh SUV.",
  },
]

export function mockSearchProvider(script: MockSearchScript = (query) => (/\b(?:bikes|cars)\b.*price list|price list .*\b(?:bikes|cars)\b/.test(query) ? MOCK_MODEL_RESULTS : MOCK_RESULTS)): SearchProvider {
  return {
    name: "mock",
    async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
      signal.throwIfAborted()
      return script(query)
    },
  }
}
