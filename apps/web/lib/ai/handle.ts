import { z } from "zod"
import { type ChatRun, MAX_OUTPUT_TOKENS, MAX_ROUNDS, runChat } from "./chat"
import type { LlmConfig } from "./config"
import { MAX_TURNS, type StoredTurn, buildHistory } from "./history"
import { MAX_QUESTION_CHARS } from "./limits"
import { formatFigure } from "./placeholders"
import { callCostMicroUsd, microToUsd } from "./llm/prices"
import type { LlmProvider } from "./llm/types"
import type { PrivateTerms } from "./search/query"
import { type SearchDb, WebSession } from "./search/session"
import type { SearchProvider } from "./search/types"
import { accountBalancesTool, netWorthTool } from "./tools/balances"
import { incomeVsExpensesTool, savingsRateTool } from "./tools/cash-flow"
import { categoryBreakdownTool } from "./tools/categories"
import { goalProjectionTool } from "./tools/goals"
import { loansAndCardsTool } from "./tools/liabilities"
import { searchTransactionsTool } from "./tools/search"
import { tripCheckTool } from "./tools/trip"
import { spendingTool } from "./tools/spending"
import type { FinanceTool, Figure, ToolContext, WebBlock } from "./tools/types"
import { webPriceFiguresTool, webPriceLookupTool } from "./tools/web-prices"

// POST /api/ai/chat, without the framework (Sprint 10.1; the remaining tools from 10.2). Order: signed in, Roma configured,
// a valid question, the conversation's stored turns (10.3), then roma_begin_request (kill
// switch, opt-in, caps, daily limit: all in the database). Only after a reservation is a
// provider made and called. The reservation is settled with the real cost when a call was
// sent, and released when none was, so only a real call consumes budget. An answer is then
// recorded as a turn (roma_record_turn, idempotent per request, so it is retried once); a
// refused or failed question is not stored. From 10.8, when web lookups are configured, the
// question gets a WebSession: the web tools are offered, their credits are reserved on first
// use and settled or released once the question ends, whatever the outcome.

export const ROMA_TOOLS: readonly FinanceTool[] = [
  spendingTool,
  incomeVsExpensesTool,
  savingsRateTool,
  categoryBreakdownTool,
  searchTransactionsTool,
  accountBalancesTool,
  netWorthTool,
  loansAndCardsTool,
  goalProjectionTool,
  tripCheckTool,
] as FinanceTool[]

/** Offered only when web lookups are on for this question (10.8). */
export const WEB_TOOLS: readonly FinanceTool[] = [webPriceLookupTool, webPriceFiguresTool] as FinanceTool[]

const questionSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  /** The conversation to continue; absent or null starts a new one. */
  conversationId: z.uuid().nullable().optional(),
})

/** A call whose usage is unknown (it failed after it may have been sent) is charged at this. */
const UNKNOWN_CALL_INPUT_TOKENS = 16_000

export type BeginOutcome = "ok" | "disabled" | "not_enabled" | "global_budget" | "user_budget" | "daily_limit"

export type RomaDb = {
  begin(provider: string, model: string): Promise<{ outcome: BeginOutcome; requestId: string | null } | null>
  settle(requestId: string, inputTokens: number, outputTokens: number, costUsd: number): Promise<boolean>
  release(requestId: string): Promise<boolean>
}

export type RecordedTurn = { conversationId: string; seq: number }

export type TurnToRecord = Omit<StoredTurn, "seq"> & { requestId: string; conversationId: string | null }

export type RomaHistory = {
  /** The conversation's turns; "missing" when it isn't the caller's (or was deleted); null when it can't be read. */
  load(conversationId: string): Promise<StoredTurn[] | "missing" | null>
  /** Records an answered turn; null when it couldn't be saved. Same request id, same turn. */
  record(turn: TurnToRecord): Promise<RecordedTurn | null>
}

export type ChatDeps = {
  signedIn: boolean
  config: LlmConfig
  db: RomaDb
  history: RomaHistory
  /** Builds the provider; may throw (then nothing was sent). */
  makeProvider: () => LlmProvider
  /** The person's today and currency, or null when they can't be read. */
  loadContext: () => Promise<ToolContext | null>
  run?: typeof runChat
  /** Server diagnostic when an answer is refused by the figure check: the numbers only, never the answer; not stored. */
  onUnverified?: (unmatched: readonly string[]) => void
  /** Web lookups (10.8); absent when SEARCH_ENABLED is off. */
  search?: {
    db: SearchDb
    /** May throw (then the question goes on without web lookups). */
    makeProvider: () => SearchProvider
    /** The person's own words a query must never carry, and their country code; null when they can't be read. */
    loadTerms: () => Promise<{ terms: PrivateTerms; countryCode: string | null } | null>
  }
}

export type ChatErrorCode =
  | "signed_out"
  | "invalid"
  | "conversation_missing"
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
      /** Matching descriptions were left out: show the notice and ask once (10.2). */
      descriptionsNotice?: true
      /** Goal and trip checks (10.4, 10.5): the verdict computed in code and its assumptions. */
      /** `web`: the separate web-assisted line (10.8), shown after the records' verdict, never instead of it. */
      checks?: { kind?: "trip"; goal: string; verdict: string; assumptions: string[]; web?: { verdict: string; summary: string; webOnly?: true } }[]
      /** Web estimates (10.8): prices as found with their site and link, totals per currency; never part of the verdict. */
      web?: WebBlock
      /** Why web lookups were skipped (caps, timeouts). */
      webNotices?: string[]
      /** The conversation the turn was recorded in (10.3); null when it couldn't be saved. */
      conversationId: string | null
      saved: boolean
    }
  | { status: "error"; code: ChatErrorCode; message: string }

export const CHAT_MESSAGES: Record<ChatErrorCode, string> = {
  signed_out: "Sign in to ask Roma.",
  invalid: `Ask a question of up to ${MAX_QUESTION_CHARS} characters.`,
  conversation_missing: "This conversation was deleted. Start a new one to ask Roma.",
  off: "Roma is off right now.",
  not_enabled: "Turn Roma on in Settings to ask her questions.",
  global_budget: "Roma has reached this month's limit. She'll be back on the 1st.",
  user_budget: "You've reached your Roma limit for this month. It resets on the 1st.",
  daily_limit: "You've asked Roma as many questions as allowed today. Try again tomorrow.",
  unverified:
    "Roma's answer had a number she couldn't match to a figure from your records, so it isn't shown. Ask about one thing at a time and name the period, account, goal or trip details you mean.",
  tone: "Roma's answer didn't follow her rules, so it isn't shown. Try asking again.",
  timeout: "Roma took too long. Try a narrower question.",
  refusal: "Roma can't help with that question.",
  unavailable: "Roma couldn't answer just now. Try again in a moment.",
}

const STATUS: Record<ChatErrorCode, number> = {
  signed_out: 401,
  invalid: 400,
  conversation_missing: 404,
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

  // Read before reserving: an unknown conversation or a failed read costs nothing.
  let conversationId = parsed.data.conversationId ?? null
  let turns: StoredTurn[] = []
  if (conversationId) {
    const loaded = await deps.history.load(conversationId)
    if (loaded === null) return error("unavailable")
    if (loaded === "missing") return error("conversation_missing")
    turns = loaded
    // A full conversation (MAX_TURNS) carries on in a new one.
    if (turns.length >= MAX_TURNS) {
      conversationId = null
      turns = []
    }
  }

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

  // Without a provider or the person's words to keep out, the question goes on without the web.
  let web: WebSession | null = null
  if (deps.search) {
    try {
      const loaded = await deps.search.loadTerms()
      if (loaded) web = new WebSession({ provider: deps.search.makeProvider(), db: deps.search.db, requestId, ...loaded })
    } catch {
      web = null
    }
  }
  if (web) context = { ...context, web }

  let run: ChatRun
  try {
    run = await (deps.run ?? runChat)({
      provider,
      tools: web ? [...ROMA_TOOLS, ...WEB_TOOLS] : ROMA_TOOLS,
      context,
      question: parsed.data.question,
      history: buildHistory(turns, context.descriptionsOk),
    })
  } catch {
    await finishWeb(web)
    // An unexpected failure mid-way: calls may have been sent, so charge the worst case.
    await deps.db.settle(requestId, 0, 0, microToUsd(worstCaseQuestionMicroUsd(model)))
    return lookupsNoted(error("unavailable"), web)
  }
  // No answer shown, but web lookups were spent: the message says so (10.8).
  const noted = (failure: { status: number; body: ChatResponseBody }) => lookupsNoted(failure, web)

  await finishWeb(web)
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
    case "answer": {
      const turn: TurnToRecord = {
        requestId,
        conversationId,
        question: parsed.data.question,
        answer: result.text,
        asOf: context.today,
        periods: result.periods,
        tools: result.toolsRan,
        sentDescriptions: result.descriptionsSent,
      }
      // Recording is idempotent per request id, so one retry can't store the turn twice.
      const recorded = (await recordQuietly(deps.history, turn)) ?? (await recordQuietly(deps.history, turn))
      return {
        status: 200,
        body: {
          status: "answer",
          answer: result.text,
          figures: result.figures.filter((f) => !f.hideWhenZero || figureValue(f) !== 0).map((f) => ({ label: f.label, value: formatFigure(f) })),
          periods: result.periods.map((p) => ({ from: p.start, to: p.end })),
          ...(result.descriptionsWithheld ? { descriptionsNotice: true as const } : {}),
          ...(result.checks.length > 0
            ? { checks: result.checks.map(({ kind, goal, verdict, assumptions, web }) => ({ ...(kind ? { kind } : {}), goal, verdict, assumptions, ...(web ? { web } : {}) })) }
            : {}),
          ...(result.web ? { web: result.web } : {}),
          ...(result.webNotices ? { webNotices: result.webNotices } : {}),
          conversationId: recorded?.conversationId ?? null,
          saved: recorded !== null,
        },
      }
    }
    case "unverified": {
      deps.onUnverified?.(result.unmatched)
      const shown = result.unmatched.slice(0, 3)
      if (shown.length === 0) return noted(error("unverified"))
      const nums = shown.length === 1 ? shown[0]! : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`
      const more = result.unmatched.length > shown.length ? " and others" : ""
      return noted({
        status: STATUS.unverified,
        body: {
          status: "error",
          code: "unverified",
          message: `Roma's answer used ${nums}${more}, which she couldn't match to a figure from your records, so it isn't shown. Ask about one thing at a time and name the period, account, goal or trip details you mean.`,
        },
      })
    }
    case "tone":
    case "invalid":
      return noted(error("tone"))
    case "failed":
      if (result.reason === "timeout") return noted(error("timeout"))
      if (result.reason === "refusal") return noted(error("refusal"))
      return noted(error("unavailable"))
  }
}

/** An error after web lookups were sent says they were used, so a spent lookup is never silent. */
function lookupsNoted(failure: { status: number; body: ChatResponseBody }, web: WebSession | null): { status: number; body: ChatResponseBody } {
  const sent = web?.lookupsSent ?? 0
  if (sent === 0 || failure.body.status !== "error") return failure
  const used = `${sent} web ${sent === 1 ? "lookup" : "lookups"} ran for this question and ${sent === 1 ? "counts" : "count"} toward your allowance.`
  return { ...failure, body: { ...failure.body, message: `${failure.body.message} ${used}` } }
}

/** Search credits end with the question: a failure leaves the reservation counting, the safe side. */
async function finishWeb(web: WebSession | null): Promise<void> {
  try {
    await web?.finish()
  } catch {
    // The reservation keeps counting at its reserved credits.
  }
}

async function recordQuietly(history: RomaHistory, turn: TurnToRecord): Promise<RecordedTurn | null> {
  try {
    return await history.record(turn)
  } catch {
    return null
  }
}

const figureValue = (f: Figure) => (f.kind === "money" ? f.minor : f.kind === "percent" ? f.bps : f.value)

const unknownCallMicroUsd = (model: string) =>
  callCostMicroUsd(model, { inputTokens: UNKNOWN_CALL_INPUT_TOKENS, outputTokens: MAX_OUTPUT_TOKENS, cacheReadTokens: 0, cacheWriteTokens: 0 })

/** The most one question can cost (roma_settings.reserve_usd must stay above it). */
export const worstCaseQuestionMicroUsd = (model: string) => MAX_ROUNDS * unknownCallMicroUsd(model)
