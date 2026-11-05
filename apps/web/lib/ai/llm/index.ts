import type { LlmConfig } from "../config"
import { anthropicProvider } from "./anthropic"
import { mockProvider } from "./mock"
import type { LlmProvider } from "./types"

/** The provider for an "on" configuration (config.ts has already applied the CI and production guards). */
export function createProvider(config: Extract<LlmConfig, { status: "on" }>): LlmProvider {
  switch (config.provider) {
    case "mock":
      return mockProvider()
    case "anthropic":
      if (!config.apiKey) throw new Error("The Anthropic provider needs a key")
      return anthropicProvider({ apiKey: config.apiKey, model: config.model })
  }
}
