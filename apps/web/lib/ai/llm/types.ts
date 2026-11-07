// The provider-neutral LLM contract (Sprint 10). Roma's chat loop, tools and tests use only
// these types; each provider adapter (anthropic.ts, mock.ts) translates to and from them, so
// a provider can be replaced without touching the rest of Roma.

/** A tool as offered to the model: a name, what it does, and a JSON Schema for its input. */
export type LlmToolDef = { name: string; description: string; inputSchema: Record<string, unknown> }

export type LlmToolCall = { id: string; name: string; input: unknown }

export type LlmToolResult = { callId: string; content: string; isError?: boolean }

export type LlmMessage =
  | { role: "user"; text: string }
  /**
   * `providerContent` is the adapter's own record of the turn (e.g. thinking blocks), passed
   * back unchanged on the next round of the same question. Other code never reads it.
   */
  | { role: "assistant"; text: string; toolCalls: LlmToolCall[]; providerContent?: unknown }
  | { role: "tool_results"; results: LlmToolResult[] }

export type LlmRequest = {
  /** System text blocks: the stable prompt first, then per-request context. */
  system: string[]
  messages: LlmMessage[]
  tools: LlmToolDef[]
  maxOutputTokens: number
  /** "off": a structured round that needs no reasoning (a plan's picks, 10.9); the adapter turns thinking off where the model allows it. */
  thinking?: "off"
}

export type LlmUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }

export const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  }
}

/** Why the model stopped: finished, wants tools, ran out of output, or declined. */
export type LlmStop = "end" | "tool_use" | "max_tokens" | "refusal" | "other"

export type LlmResponse = {
  stop: LlmStop
  text: string
  toolCalls: LlmToolCall[]
  usage: LlmUsage
  providerContent?: unknown
}

/**
 * A failed call. `billed` says whether the provider may have charged for it: "no" when it
 * answered with an error (nothing generated), "unknown" when the connection failed or timed
 * out after the request may have been sent.
 */
export type LlmErrorKind = "timeout" | "rate_limited" | "unavailable" | "rejected"

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    readonly billed: "no" | "unknown",
    message: string,
  ) {
    super(message)
    this.name = "LlmError"
  }
}

export interface LlmProvider {
  /** Ledger labels (roma_usage.provider and .model). */
  readonly name: string
  readonly model: string
  complete(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse>
}
