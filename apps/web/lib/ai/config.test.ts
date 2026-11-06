import { describe, expect, it } from "vitest"
import { readLlmConfig, readSearchConfig } from "./config"
import { callCostMicroUsd, microToUsd } from "./llm/prices"
import { worstCaseQuestionMicroUsd } from "./handle"

describe("Roma configuration", () => {
  const anthropic = { LLM_ENABLED: "true", LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-real" }

  it("is off unless LLM_ENABLED is exactly true", () => {
    expect(readLlmConfig({})).toEqual({ status: "off", reason: "not_enabled" })
    expect(readLlmConfig({ ...anthropic, LLM_ENABLED: "1" })).toEqual({ status: "off", reason: "not_enabled" })
  })

  it("is off without a key", () => {
    expect(readLlmConfig({ ...anthropic, ANTHROPIC_API_KEY: " " })).toEqual({ status: "off", reason: "no_key" })
  })

  it("uses Claude Haiku 5.5 by default", () => {
    expect(readLlmConfig(anthropic)).toEqual({ status: "on", provider: "anthropic", model: "claude-haiku-5-5", apiKey: "test-key-not-real" })
  })

  it("refuses a model it has no price for", () => {
    expect(readLlmConfig({ ...anthropic, LLM_MODEL: "some-other-model" })).toEqual({ status: "off", reason: "unknown_model" })
  })

  it("never uses a paid provider in CI", () => {
    expect(readLlmConfig({ ...anthropic, CI: "true" })).toEqual({ status: "off", reason: "ci" })
    expect(readLlmConfig({ LLM_ENABLED: "true", LLM_PROVIDER: "mock", CI: "true" })).toMatchObject({ status: "on", provider: "mock" })
  })

  it("never uses the mock on a production deployment", () => {
    expect(readLlmConfig({ LLM_ENABLED: "true", LLM_PROVIDER: "mock", VERCEL_ENV: "production" })).toEqual({
      status: "off",
      reason: "mock_in_production",
    })
  })

  it("refuses an unknown provider", () => {
    expect(readLlmConfig({ LLM_ENABLED: "true", LLM_PROVIDER: "other" })).toEqual({ status: "off", reason: "unknown_provider" })
  })
})

describe("Roma costs", () => {
  it("prices Claude Haiku 5.5 at $0.10 / $0.50 per million tokens", () => {
    const usage = { inputTokens: 4000, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 }
    expect(callCostMicroUsd("claude-haiku-5-5", usage)).toBe(700) // $0.0007
    expect(microToUsd(700)).toBe(0.0007)
  })

  it("uses the higher rates above 100,000 prompt tokens, cache reads included", () => {
    const usage = { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 100_000, cacheWriteTokens: 0 }
    expect(callCostMicroUsd("claude-haiku-5-5", usage)).toBe(500 + 5000)
  })

  it("rounds up to whole micro-dollars and costs the mock nothing", () => {
    expect(callCostMicroUsd("claude-haiku-5-5", { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(1)
    expect(callCostMicroUsd("mock", { inputTokens: 9999, outputTokens: 9999, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0)
  })

  it("keeps one question's worst case under the $0.01 reserved in roma_settings", () => {
    expect(worstCaseQuestionMicroUsd("claude-haiku-5-5")).toBeLessThan(10_000)
  })
})

describe("Web lookup configuration", () => {
  const tavily = { SEARCH_ENABLED: "true", SEARCH_PROVIDER: "tavily", TAVILY_API_KEY: "test-key-not-real" }

  it("is off unless SEARCH_ENABLED is exactly true, and without a key", () => {
    expect(readSearchConfig({})).toEqual({ status: "off", reason: "not_enabled" })
    expect(readSearchConfig({ ...tavily, SEARCH_ENABLED: "1" })).toEqual({ status: "off", reason: "not_enabled" })
    expect(readSearchConfig({ ...tavily, TAVILY_API_KEY: " " })).toEqual({ status: "off", reason: "no_key" })
    expect(readSearchConfig(tavily)).toEqual({ status: "on", provider: "tavily", apiKey: "test-key-not-real" })
  })

  it("never uses a real provider in CI, and never the mock in production", () => {
    expect(readSearchConfig({ ...tavily, CI: "true" })).toEqual({ status: "off", reason: "ci" })
    expect(readSearchConfig({ SEARCH_ENABLED: "true", SEARCH_PROVIDER: "mock", CI: "true" })).toMatchObject({ status: "on", provider: "mock" })
    expect(readSearchConfig({ SEARCH_ENABLED: "true", SEARCH_PROVIDER: "mock", VERCEL_ENV: "production" })).toEqual({ status: "off", reason: "mock_in_production" })
    expect(readSearchConfig({ ...tavily, SEARCH_PROVIDER: "other" })).toEqual({ status: "off", reason: "unknown_provider" })
  })
})
