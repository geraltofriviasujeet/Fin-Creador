import type { SearchProvider, SearchResult } from "./types"

// The mock search provider: every automated test and the E2E server use it, so no test ever
// spends a credit. Recorded results, labelled as test data; the same results for any query
// unless a test passes its own script.

export type MockSearchScript = (query: string) => SearchResult[] | Promise<SearchResult[]>

export const MOCK_RESULTS: SearchResult[] = [
  {
    title: "Test data: hotel prices",
    url: "https://example.test/hotels",
    snippet: "Test data. Mid-range hotels cost about ₹4,500 per night in this season.",
  },
  {
    title: "Test data: flight prices",
    url: "https://example.test/flights",
    snippet: "Test data. Return flights from about ₹18,000 per person.",
    content: "Test data. Return flights from about ₹18,000 per person; budget carriers sometimes lower.",
  },
]

export function mockSearchProvider(script: MockSearchScript = () => MOCK_RESULTS): SearchProvider {
  return {
    name: "mock",
    async search(query: string, signal: AbortSignal): Promise<SearchResult[]> {
      signal.throwIfAborted()
      return script(query)
    },
  }
}
