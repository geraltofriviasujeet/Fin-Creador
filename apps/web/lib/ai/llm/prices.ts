import type { LlmUsage } from "./types"

// Model prices in micro-dollars (µ$) per million tokens, from the provider's pricing page.
// Claude Haiku 5.5, checked 2026-11-05: $0.10 input, $0.50 output, $0.01 cache reads, $0.125
// 5-minute cache writes, for prompts up to 100,000 tokens; five times that above (all input
// counted: uncached, cache reads and cache writes). A model missing here can't be costed, so
// Roma stays off with it (config.ts).

type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number }
type ModelPrice = { base: Rates; long?: { overInputTokens: number; rates: Rates } }

const PRICES: Record<string, ModelPrice> = {
  "claude-haiku-5-5": {
    base: { input: 100_000, output: 500_000, cacheRead: 10_000, cacheWrite: 125_000 },
    long: { overInputTokens: 100_000, rates: { input: 500_000, output: 2_500_000, cacheRead: 50_000, cacheWrite: 625_000 } },
  },
  mock: { base: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
}

export const hasPrice = (model: string) => Object.hasOwn(PRICES, model)

/** The cost of one call in whole micro-dollars, rounded up. */
export function callCostMicroUsd(model: string, usage: LlmUsage): number {
  const price = PRICES[model]
  if (!price) throw new RangeError(`No price for model ${model}`)
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const rates = price.long && promptTokens > price.long.overInputTokens ? price.long.rates : price.base
  const scaled =
    usage.inputTokens * rates.input +
    usage.outputTokens * rates.output +
    usage.cacheReadTokens * rates.cacheRead +
    usage.cacheWriteTokens * rates.cacheWrite
  return Math.ceil(scaled / 1_000_000)
}

/** µ$ as the ledger's dollar figure (numeric(12, 6)). */
export const microToUsd = (micro: number) => Number((micro / 1_000_000).toFixed(6))
