import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { documentChunks, parseDocument } from "./knowledge.ts"
import { UNKNOWN_CALL_INPUT_TOKENS, toolsFor } from "../apps/web/lib/ai/handle"
import { MAX_OUTPUT_TOKENS } from "../apps/web/lib/ai/chat"
import { callCostMicroUsd } from "../apps/web/lib/ai/llm/prices"
import { KNOWLEDGE_RULES, ROMA_SYSTEM_PROMPT, romaContext } from "../apps/web/lib/ai/prompts/roma-system"
import { toToolDef } from "../apps/web/lib/ai/tools/types"
import { KNOWLEDGE_COUNT } from "../apps/web/lib/ai/knowledge/session"

// What a knowledge answer sends (10.6c): two rounds (the search, then the answer with the
// passages), with the four longest real passages. Tokens are estimated at 3 characters each,
// on the high side for English (₹ amounts and Indian grouping tokenize worse than prose).
// Every call must stay under the input bound the reserve in roma_settings is sized for.

const DIR = join(__dirname, "../supabase/knowledge")
const passages = readdirSync(DIR)
  .filter((n) => n.endsWith(".md") && n !== "README.md")
  .flatMap((n) => documentChunks(parseDocument(n, readFileSync(join(DIR, n), "utf8"))))
  .sort((a, b) => b.length - a.length)
  .slice(0, KNOWLEDGE_COUNT)

function knowledgeAnswerTokens(route: "knowledge" | "both") {
  const tokens = (text: string) => Math.ceil(text.length / 3)
  const system = [ROMA_SYSTEM_PROMPT, romaContext({ today: "2026-11-14", currency: "INR", route }), KNOWLEDGE_RULES].join("\n")
  const tools = JSON.stringify(toolsFor(route, true).map(toToolDef))
  const question = "What are the old regime tax slabs for tax year 2026-27?"
  const result = JSON.stringify({ passages: passages.map((p, i) => ({ id: `k${i + 1}`, title: "A title of about this length", text: `<passage k${i + 1}>\n${p}\n</passage k${i + 1}>` })) })
  const first = tokens(system) + tokens(tools) + tokens(question)
  const second = first + 100 + tokens(result)
  return { first, second, passageChars: passages.reduce((n, p) => n + p.length, 0) }
}

describe("knowledge answer cost", () => {
  it("keeps each call under the input bound the $0.01 reserve assumes, with four of the longest passages", () => {
    for (const route of ["knowledge", "both"] as const) {
      const { first, second } = knowledgeAnswerTokens(route)
      expect(second).toBeLessThan(UNKNOWN_CALL_INPUT_TOKENS)
      const micro =
        callCostMicroUsd("claude-haiku-5-5", { inputTokens: first, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 }) +
        callCostMicroUsd("claude-haiku-5-5", { inputTokens: second, outputTokens: MAX_OUTPUT_TOKENS, cacheReadTokens: 0, cacheWriteTokens: 0 })
      expect(micro).toBeLessThan(10_000)
    }
  })
})
