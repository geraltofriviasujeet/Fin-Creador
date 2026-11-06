// The provider-neutral web search contract (Sprint 10.8), mirroring llm/types.ts. Roma's web
// lookup tool and its tests use only these types; tavily.ts and mock.ts translate to them.
// Search results are untrusted text: they are read for figures and never trigger an action.

export type SearchResult = {
  title: string
  url: string
  /** The provider's short extract of the page. */
  snippet: string
  /** The page's fuller text, when the provider sent it (used to verify a figure). */
  content?: string
  publishedAt?: string
}

/**
 * A failed search. `billed` says whether the provider may have charged a credit: "no" when it
 * answered with an error, "unknown" when the connection failed or timed out after sending.
 */
export type SearchErrorKind = "timeout" | "rate_limited" | "unavailable" | "rejected"

export class SearchError extends Error {
  constructor(
    readonly kind: SearchErrorKind,
    readonly billed: "no" | "unknown",
    message: string,
  ) {
    super(message)
    this.name = "SearchError"
  }
}

export interface SearchProvider {
  /** Ledger label (roma_search_usage.provider). */
  readonly name: string
  search(query: string, signal: AbortSignal): Promise<SearchResult[]>
}
