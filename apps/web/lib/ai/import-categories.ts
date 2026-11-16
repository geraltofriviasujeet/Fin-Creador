import { cleanUpiPayee } from "@fin-creador/domain"
import { CATEGORY_SLOTS, CATEGORY_SLOT_KEYS, type CategorySlot, isCategorySlot } from "@fin-creador/schemas"
import { z } from "zod"
import type { LlmConfig } from "./config"
import type { RulesOnlyReason, SuggestBeginOutcome } from "./import-categories-text"
import { callCostMicroUsd, microToUsd } from "./llm/prices"
import { LlmError, type LlmProvider, type LlmToolDef } from "./llm/types"

// Category suggestions for imported UPI payments (Sprint 9e), only for payee names no rule
// covers, only after the person allowed it. Sent: each payee name (cleaned again here: anything
// shaped like a UPI id or email and runs of 4 or more digits removed; a name equal to the person's
// own display name dropped) with a short id, and the fixed list of category keys. Never amounts,
// dates, account details or the person's own name. The reply must give a key from the list per id
// (the set_categories tool); anything else is ignored and falls to Miscellaneous.
//
// Every call goes through the database first (import_categories_begin: kill switches, consent,
// Roma's monthly caps, the import daily limit), one reservation per batch of up to 100 names,
// settled with the real cost or released when nothing was sent. When a batch is refused or fails,
// the remaining names get no suggestion and the page says categories came from rules only.

/** Names per model call. */
export const SUGGEST_BATCH_SIZE = 100
const MAX_OUTPUT_TOKENS = 2_000
const CALL_DEADLINE_MS = 20_000
/** Charged when a call failed after it may have been sent (input of a full batch, all output). */
const UNKNOWN_CALL_INPUT_TOKENS = 4_000

export type { RulesOnlyReason, SuggestBeginOutcome } from "./import-categories-text"
export { RULES_ONLY_TEXT } from "./import-categories-text"

export type SuggestDb = {
  begin(provider: string, model: string): Promise<{ outcome: SuggestBeginOutcome; requestId: string | null } | null>
  settle(requestId: string, inputTokens: number, outputTokens: number, costUsd: number): Promise<boolean>
  release(requestId: string): Promise<boolean>
}


export type SuggestResult = {
  /** Slot per id, for the names that got a valid one. */
  suggestions: Record<string, CategorySlot>
  /** Null when every batch was answered. */
  rulesOnly: RulesOnlyReason | null
  calls: number
}

export const SUGGEST_SYSTEM = [
  "You sort payee names from an Indian UPI payment statement into spending categories.",
  "Each line is <id>: <payee name>. Reply only by calling set_categories, giving each id exactly one key from the list.",
  "Use money_sent when the name is a person rather than a business. Use misc when unsure. Never invent keys or ids.",
  "Keys:",
  ...CATEGORY_SLOT_KEYS.map((k) => `${k}: ${CATEGORY_SLOTS[k].hint}`),
].join("\n")

export const SET_CATEGORIES_TOOL: LlmToolDef = {
  name: "set_categories",
  description: "Gives each payee id one category key from the list.",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, key: { type: "string", enum: CATEGORY_SLOT_KEYS } },
          required: ["id", "key"],
        },
      },
    },
    required: ["items"],
  },
}

const reply = z.object({ items: z.array(z.object({ id: z.string(), key: z.unknown() }).loose()).max(SUGGEST_BATCH_SIZE * 2) }).loose()

/** A payee name as it may be sent, or null when nothing is left or it is the person's own name. */
export function nameToSend(name: string, ownName: string | null): string | null {
  const cleaned = cleanUpiPayee(name).slice(0, 80)
  if (cleaned === "") return null
  const own = ownName?.replace(/\s+/g, " ").trim().toLowerCase()
  if (own && own.length >= 3 && cleaned.toLowerCase().includes(own)) return null
  return cleaned
}

/** The valid suggestions in a reply: ids from this batch with a key from the list; anything else ignored. */
export function readSuggestions(input: unknown, ids: ReadonlySet<string>): Record<string, CategorySlot> {
  const parsed = reply.safeParse(input)
  if (!parsed.success) return {}
  const out: Record<string, CategorySlot> = {}
  for (const item of parsed.data.items) if (ids.has(item.id) && !(item.id in out) && isCategorySlot(item.key)) out[item.id] = item.key
  return out
}

export async function suggestCategories(deps: {
  config: LlmConfig
  db: SuggestDb
  makeProvider: () => LlmProvider
  ownName: string | null
  names: readonly { id: string; name: string }[]
}): Promise<SuggestResult> {
  if (deps.config.status !== "on") return { suggestions: {}, rulesOnly: "off", calls: 0 }
  const sendable = deps.names.flatMap((n) => {
    const name = nameToSend(n.name, deps.ownName)
    return name ? [{ id: n.id, name }] : []
  })
  const result: SuggestResult = { suggestions: {}, rulesOnly: null, calls: 0 }
  if (sendable.length === 0) return result

  let provider: LlmProvider
  try {
    provider = deps.makeProvider()
  } catch {
    return { ...result, rulesOnly: "off" }
  }
  const model = deps.config.model

  for (let at = 0; at < sendable.length; at += SUGGEST_BATCH_SIZE) {
    const batch = sendable.slice(at, at + SUGGEST_BATCH_SIZE)
    const begun = await deps.db.begin(provider.name, provider.model).catch(() => null)
    if (!begun || begun.outcome !== "ok" || !begun.requestId) return { ...result, rulesOnly: begun && begun.outcome !== "ok" ? begun.outcome : "failed" }
    const requestId = begun.requestId
    try {
      const response = await provider.complete(
        {
          system: [SUGGEST_SYSTEM],
          messages: [{ role: "user", text: batch.map((b) => `${b.id}: ${b.name}`).join("\n") }],
          tools: [SET_CATEGORIES_TOOL],
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinking: "off",
        },
        AbortSignal.timeout(CALL_DEADLINE_MS),
      )
      result.calls++
      const u = response.usage
      await deps.db.settle(requestId, u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens, u.outputTokens, microToUsd(callCostMicroUsd(model, u)))
      const call = response.toolCalls.find((c) => c.name === SET_CATEGORIES_TOOL.name)
      Object.assign(result.suggestions, call ? readSuggestions(call.input, new Set(batch.map((b) => b.id))) : {})
    } catch (error) {
      if (error instanceof LlmError && error.billed === "no") await deps.db.release(requestId)
      else {
        // It may have been sent: charge the worst case, the safe side.
        const worst = callCostMicroUsd(model, { inputTokens: UNKNOWN_CALL_INPUT_TOKENS, outputTokens: MAX_OUTPUT_TOKENS, cacheReadTokens: 0, cacheWriteTokens: 0 })
        await deps.db.settle(requestId, 0, 0, microToUsd(worst))
      }
      return { ...result, rulesOnly: "failed" }
    }
  }
  return result
}
