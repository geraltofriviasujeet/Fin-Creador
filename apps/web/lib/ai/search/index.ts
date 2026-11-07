import type { SearchConfig } from "../config"
import { mockSearchProvider } from "./mock"
import { tavilyProvider } from "./tavily"
import type { SearchProvider } from "./types"

/** The provider for an "on" configuration (config.ts has already applied the CI and production guards). */
export function createSearchProvider(config: Extract<SearchConfig, { status: "on" }>): SearchProvider {
  switch (config.provider) {
    case "mock":
      return mockSearchProvider()
    case "tavily":
      if (!config.apiKey) throw new Error("The Tavily provider needs a key")
      return tavilyProvider({ apiKey: config.apiKey })
  }
}
