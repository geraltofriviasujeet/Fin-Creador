import { hasPrice } from "./llm/prices"

// Roma's server configuration (Sprint 10). Server-only variables, never NEXT_PUBLIC_: the key
// must not reach the browser (the CI secret check scans the client bundle for it). The caps
// are not here: they live in the database (roma_settings), where no caller can change them.
//
//   LLM_ENABLED=true          off unless exactly "true"
//   LLM_PROVIDER=anthropic    or "mock" (tests and the E2E server)
//   LLM_MODEL=claude-haiku-5-5
//   ANTHROPIC_API_KEY=        required for anthropic
//
// Guards: a real provider is refused when CI is set (tests never call a paid API), and the
// mock is refused on a Vercel production deployment (it must never answer a real person).

export const PROVIDERS = ["anthropic", "mock"] as const
export type ProviderName = (typeof PROVIDERS)[number]

export type LlmConfig =
  | { status: "on"; provider: ProviderName; model: string; apiKey: string | null }
  | { status: "off"; reason: "not_enabled" | "no_key" | "unknown_provider" | "unknown_model" | "ci" | "mock_in_production" }

const DEFAULT_MODEL = "claude-haiku-5-5"

export function readLlmConfig(env: Record<string, string | undefined>): LlmConfig {
  if (env.LLM_ENABLED !== "true") return { status: "off", reason: "not_enabled" }

  const provider = (env.LLM_PROVIDER ?? "anthropic").trim()
  if (!(PROVIDERS as readonly string[]).includes(provider)) return { status: "off", reason: "unknown_provider" }

  if (provider === "mock") {
    if (env.VERCEL_ENV === "production") return { status: "off", reason: "mock_in_production" }
    return { status: "on", provider: "mock", model: "mock", apiKey: null }
  }

  if (env.CI) return { status: "off", reason: "ci" }
  const apiKey = env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) return { status: "off", reason: "no_key" }
  const model = env.LLM_MODEL?.trim() || DEFAULT_MODEL
  if (!hasPrice(model)) return { status: "off", reason: "unknown_model" }
  return { status: "on", provider: "anthropic", model, apiKey }
}

// Web lookups (Sprint 10.8), the same way. The credit caps are not here either: they live in
// roma_settings beside the model caps.
//
//   SEARCH_ENABLED=true       off unless exactly "true"
//   SEARCH_PROVIDER=tavily    or "mock" (tests and the E2E server)
//   TAVILY_API_KEY=           required for tavily

export const SEARCH_PROVIDERS = ["tavily", "mock"] as const
export type SearchProviderName = (typeof SEARCH_PROVIDERS)[number]

export type SearchConfig =
  | { status: "on"; provider: SearchProviderName; apiKey: string | null }
  | { status: "off"; reason: "not_enabled" | "no_key" | "unknown_provider" | "ci" | "mock_in_production" }

export function readSearchConfig(env: Record<string, string | undefined>): SearchConfig {
  if (env.SEARCH_ENABLED !== "true") return { status: "off", reason: "not_enabled" }

  const provider = (env.SEARCH_PROVIDER ?? "tavily").trim()
  if (!(SEARCH_PROVIDERS as readonly string[]).includes(provider)) return { status: "off", reason: "unknown_provider" }

  if (provider === "mock") {
    if (env.VERCEL_ENV === "production") return { status: "off", reason: "mock_in_production" }
    return { status: "on", provider: "mock", apiKey: null }
  }

  if (env.CI) return { status: "off", reason: "ci" }
  const apiKey = env.TAVILY_API_KEY?.trim()
  if (!apiKey) return { status: "off", reason: "no_key" }
  return { status: "on", provider: "tavily", apiKey }
}
