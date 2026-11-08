import { SearchError, type SearchProvider, type SearchResult } from "./types"

// The Tavily adapter (Sprint 10.8): plain fetch, no SDK. Server-side only (the key is read by
// config.ts from server environment variables). Basic depth only: 1 credit a search. The
// page's cleaned text comes back in the same call (raw_content, no extra credit) and is what
// a figure is verified against when the snippet doesn't carry it.

const ENDPOINT = "https://api.tavily.com/search"
export const SEARCH_TIMEOUT_MS = 8_000
const MAX_RESULTS = 5
/** Page text kept per result: enough to find a price, bounded for memory and the model. */
export const MAX_CONTENT_CHARS = 20_000

type Options = {
  apiKey: string
  /** Tests pass a fake fetch with recorded responses; production uses the global fetch. */
  fetch?: typeof globalThis.fetch
}

type TavilyResult = { title?: unknown; url?: unknown; content?: unknown; raw_content?: unknown; published_date?: unknown }

export function tavilyProvider({ apiKey, fetch = globalThis.fetch }: Options): SearchProvider {
  return {
    name: "tavily",
    async search(query: string, signal: AbortSignal, options?: { country?: "india" }): Promise<SearchResult[]> {
      const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            query,
            search_depth: "basic",
            max_results: MAX_RESULTS,
            include_answer: false,
            include_raw_content: "text",
            include_images: false,
            // Boosts pages from the country (Tavily's "general" topic, the default); no extra credit.
            ...(options?.country ? { country: options.country } : {}),
          }),
          signal: AbortSignal.any([signal, timeout]),
        })
      } catch {
        // Sent or not, we can't tell: count it.
        throw new SearchError(timeout.aborted ? "timeout" : "unavailable", "unknown", "The search could not be completed.")
      }
      if (!response.ok) {
        const kind = response.status === 429 ? "rate_limited" : response.status >= 500 ? "unavailable" : "rejected"
        throw new SearchError(kind, "no", `The search was refused (${response.status}).`)
      }
      const body = (await response.json().catch(() => null)) as { results?: unknown } | null
      if (!body || !Array.isArray(body.results)) throw new SearchError("unavailable", "unknown", "The search answer could not be read.")
      return (body.results as TavilyResult[]).flatMap(toResult)
    },
  }
}

/** Only well-formed http(s) results; anything else is dropped. */
function toResult(r: TavilyResult): SearchResult[] {
  if (typeof r.url !== "string" || typeof r.content !== "string") return []
  let url: URL
  try {
    url = new URL(r.url)
  } catch {
    return []
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return []
  return [
    {
      title: typeof r.title === "string" ? r.title : url.hostname,
      url: url.toString(),
      snippet: r.content,
      ...(typeof r.raw_content === "string" && r.raw_content ? { content: r.raw_content.slice(0, MAX_CONTENT_CHARS) } : {}),
      ...(typeof r.published_date === "string" ? { publishedAt: r.published_date } : {}),
    },
  ]
}
