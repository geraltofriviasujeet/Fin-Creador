import { z } from "zod"
import { formatMoney } from "@fin-creador/domain"
import { type ChatRun, MAX_OUTPUT_TOKENS, MAX_ROUNDS, runChat } from "./chat"
import type { LlmConfig } from "./config"
import { MAX_QUESTION_CHARS } from "./limits"
import { callCostMicroUsd, microToUsd } from "./llm/prices"
import type { LlmProvider } from "./llm/types"
import { spendingTool } from "./tools/spending"
import type { FinanceTool, ToolContext } from "./tools/types"

// POST /api/ai/chat, without the framework (Sprint 10.1). Order: signed in, Roma configured,
// a valid question, then roma_begin_request (kill switch, opt-in, caps, daily limit: all in
// the database). Only after a reservation is a provider made and called. The reservation is
// settled with the real cost when a call was sent, and released when none was, so only a
// real call consumes budget.

export const ROMA_TOOLS: readonly FinanceTool[] = [spendingTool as FinanceTool]

const questionSchema = z.object({ question: z.string().trim().min(1).max(MAX_QUESTION_CHARS) })

/** A call whose usage is unknown (it failed after it may have been sent) is charged at this. */
const UNKNOWN_CALL_INPUT_TOKENS = 16_000

export type BeginOutcome = "ok" | "disabled" | "not_enabled" | "global_budget" | "user_budget" | "daily_limit"

export type RomaDb = {
  begin(provider: string, model: string): Promise<{ outcome: BeginOutcome; requestId: string | null } | null>
  settle(requestId: string, inputTokens: number, outputTokens: number, costUsd: number): Promise<boolean>
  release(requestId: string): Promise<boolean>
}

export type ChatDeps = {
  signedIn: boolean
  config: LlmConfig
  db: RomaDb
  /** Builds the provider; may throw (then nothing was sent). */
  makeProvider: () => LlmProvider
  /** The person's today and currency, or null when they can't be read. */
  loadContext: () => Promise<ToolContext | null>
  run?: typeof runChat
}

export type ChatErrorCode =
  | "signed_out"
  | "invalid"
  | "off"
  | "not_enabled"
  | "global_budget"
  | "user_budget"
  | "daily_limit"
  | "unverified"
  | "tone"
  | "timeout"
  | "refusal"
  | "unavailable"

export type ChatResponseBody =
  | {
      status: "answer"
      answer: string
      figures: { label: string; value: string }[]
      periods: { from: string; to: string }[]
    }
  | { status: "error"; code: ChatErrorCode; message: string }

export const CHAT_MESSAGES: Record<ChatErrorCode, string> = {
  signed_out: "Sign in to ask Roma.",
  invalid: `Ask a question of up to ${MAX_QUESTION_CHARS} characters.`,
  off: "Roma is off right now.",
  not_enabled: "Turn Roma on in Settings to ask her questions.",
  global_budget: "Roma has reached this month's limit. She'll be back on the 1st.",
  user_budget: "You've reached your Roma limit for this month. It resets on the 1st.",
  daily_limit: "You've asked Roma as many questions as allowed today. Try again tomorrow.",
  unverified: "Roma couldn't check a number in this answer against your records, so it isn't shown. Try asking again.",
  tone: "Roma's answer didn't follow her rules, so it isn't shown. Try asking again.",
  timeout: "Roma took too long. Try a narrower question.",
  refusal: "Roma can't help with that question.",
  unavailable: "Roma couldn't answer just now. Try again in a moment.",
}

const STATUS: Record<ChatErrorCode, number> = {
  signed_out: 401,
  invalid: 400,
  off: 503,
  not_enabled: 403,
  global_budget: 503,
  user_budget: 429,
  daily_limit: 429,
  unverified: 422,
  tone: 422,
  timeout: 504,
  refusal: 422,
  unavailable: 502,
}

const error = (code: ChatErrorCode) => ({ status: STATUS[code], body: { status: "error" as const, code, message: CHAT_MESSAGES[code] } })

export async function handleChat(body: unknown, deps: ChatDeps): Promise<{ status: number; body: ChatResponseBody }> {
  if (!deps.signedIn) return error("signed_out")
  if (deps.config.status !== "on") return error("off")
  const parsed = questionSchema.safeParse(body)
  if (!parsed.success) return error("invalid")

  const { provider: providerName, model } = deps.config
  const begun = await deps.db.begin(providerName, model)
  if (!begun) return error("unavailable")
  if (begun.outcome !== "ok" || !begun.requestId) return error(begun.outcome === "disabled" || begun.outcome === "ok" ? "off" : begun.outcome)
  const requestId = begun.requestId

  // Nothing has reached the provider until runChat starts: a failure here releases.
  let context: ToolContext | null = null
  let provider: LlmProvider | null = null
  try {
    context = await deps.loadContext()
    provider = deps.makeProvider()
  } catch {
    provider = null
  }
  if (!context || !provider) {
    await deps.db.release(requestId)
    return error("unavailable")
  }

  let run: ChatRun
  try {
    run = await (deps.run ?? runChat)({ provider, tools: ROMA_TOOLS, context, question: parsed.data.question })
  } catch {
    // An unexpected failure mid-way: calls may have been sent, so charge the worst case.
    await deps.db.settle(requestId, 0, 0, microToUsd(worstCaseQuestionMicroUsd(model)))
    return error("unavailable")
  }

  if (run.calls === 0) {
    await deps.db.release(requestId)
  } else {
    const micro = callCostMicroUsd(model, run.usage) + run.unknownCalls * unknownCallMicroUsd(model)
    const inputTokens = run.usage.inputTokens + run.usage.cacheReadTokens + run.usage.cacheWriteTokens
    // A failed settle leaves the reservation counting at its reserved cost: the safe side.
    await deps.db.settle(requestId, inputTokens, run.usage.outputTokens, microToUsd(micro))
  }

  const result = run.result
  switch (result.kind) {
    case "answer":
      return {
        status: 200,
        body: {
          status: "answer",
          answer: result.text,
          figures: result.figures.filter((f) => !f.hideWhenZero || (f.kind === "money" ? f.minor : f.value) !== 0).map((f) => ({
            label: f.label,
            value: f.kind === "money" ? formatMoney(f.minor, { currency: f.currency }) : String(f.value),
          })),
          periods: result.periods.map((p) => ({ from: p.start, to: p.end })),
        },
      }
    case "unverified":
      return error("unverified")
    case "tone":
    case "invalid":
      return error("tone")
    case "failed":
      if (result.reason === "timeout") return error("timeout")
      if (result.reason === "refusal") return error("refusal")
      return error("unavailable")
  }
}

const unknownCallMicroUsd = (model: string) =>
  callCostMicroUsd(model, { inputTokens: UNKNOWN_CALL_INPUT_TOKENS, outputTokens: MAX_OUTPUT_TOKENS, cacheReadTokens: 0, cacheWriteTokens: 0 })

/** The most one question can cost (roma_settings.reserve_usd must stay above it). */
export const worstCaseQuestionMicroUsd = (model: string) => MAX_ROUNDS * unknownCallMicroUsd(model)
