import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { UserClient } from "@fin-creador/api"
import { cashFlowReport, monthStart } from "@fin-creador/domain"
import { runChat } from "./chat"
import { ROMA_TOOLS, WEB_TOOLS } from "./handle"
import { anthropicProvider } from "./llm/anthropic"
import type { LlmProvider } from "./llm/types"
import { UNKNOWN_AMOUNT } from "./placeholders"
import { type SearchDb, WebSession } from "./search/session"
import { tavilyProvider } from "./search/tavily"
import type { ToolContext } from "./tools/types"

// The live Roma measurement (10.8 follow-up): the Goa question asked 5 times against the real
// model and real Tavily, with the person's records stubbed (6 months of ₹10,000 income, no
// trip goal, no travel runs: no comparable, so the web lookups run). Counts refusals and what
// the answers did with amounts. Spends Anthropic calls and Tavily credits, so it runs only by
// hand: ROMA_LIVE=1 npx vitest run apps/web/lib/ai/roma.live.test.ts
// Never in CI. Keys are read from apps/web/.env.local and never printed. ROMA_LIVE_OUT=<file>
// writes each run's answer for inspection (outside the repo).

const run = process.env.ROMA_LIVE === "1" && !process.env.CI

const api = vi.hoisted(() => ({
  loadGoalsData: vi.fn(),
  loadCashFlow: vi.fn(),
  loadLoansData: vi.fn(),
  buildLoansView: vi.fn(),
  loadTransactionPage: vi.fn(),
  loadDashboardBreakdown: vi.fn(),
}))
vi.mock("@fin-creador/api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }))

const TODAY = "2026-11-07"
const QUESTION = "Can I afford a trip to Goa in January 2027, 4 nights for 2 people?"
const RUNS = 5

function envLocal(name: string): string {
  const text = readFileSync(join(__dirname, "../../.env.local"), "utf8")
  const line = text.split("\n").find((l) => l.startsWith(`${name}=`))
  const value = line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
  if (!value) throw new Error(`${name} is not set in apps/web/.env.local`)
  return value
}

function stubRecords() {
  const months = Array.from({ length: 7 }, (_, i) => monthStart(TODAY, i - 6))
  const monthly = months.map((m, i) => ({ month: m, incomeMinor: i < 6 ? 1_000_000 : 0, expenseMinor: 0, categories: [] }))
  api.loadGoalsData.mockResolvedValue({ ok: true, data: { today: TODAY, currency: "INR", goals: [], budgetRows: [], categories: [], spending: new Map() } })
  api.loadCashFlow.mockResolvedValue({ ok: true, data: { today: TODAY, currency: "INR", report: cashFlowReport(monthly, TODAY), otherCurrencies: [] } })
  api.loadLoansData.mockResolvedValue({ ok: true, data: {} })
  api.buildLoansView.mockReturnValue({ loans: [], shortTerm: { borrowings: [] }, statutory: { dues: [] } })
  api.loadTransactionPage.mockResolvedValue({ ok: true, items: [], nextCursor: null })
}

const categories = { data: [{ id: "travel", name: "Travel" }], error: null }
const supabase = { from: () => ({ select: () => ({ eq: () => ({ eq: async () => categories }) }) }) } as unknown as UserClient
const db: SearchDb = { begin: async () => ({ outcome: "ok", credits: 3 }), settle: async () => true, release: async () => true }

describe.skipIf(!run)("Roma live measurement (by hand only)", () => {
  it("asks the Goa question 5 times", { timeout: 600_000 }, async () => {
    stubRecords()
    // The model's own final text (before placeholders are filled in), kept to count what it wrote.
    const real = anthropicProvider({ apiKey: envLocal("ANTHROPIC_API_KEY"), model: "claude-haiku-5-5" })
    let raw = ""
    const provider: LlmProvider = {
      ...real,
      async complete(request, signal) {
        const response = await real.complete(request, signal)
        if (response.stop === "end") raw = response.text
        return response
      },
    }
    const search = tavilyProvider({ apiKey: envLocal("TAVILY_API_KEY") })
    const rows = []
    for (let i = 0; i < RUNS; i++) {
      raw = ""
      const web = new WebSession({ provider: search, db, requestId: `live-${i}`, terms: { names: [], phrases: [] }, countryCode: "IN" })
      const context: ToolContext = { supabase, today: TODAY, currency: "INR", descriptionsOk: false, web }
      const out = await runChat({ provider, tools: [...ROMA_TOOLS, ...WEB_TOOLS], context, question: QUESTION })
      const r = out.result
      rows.push({
        kind: r.kind,
        unmatched: r.kind === "unverified" ? r.unmatched : [],
        lookups: web.lookupsSent,
        kept: web.kept.length,
        webLine: r.kind === "answer" ? (r.checks[0]?.web?.summary ?? null) : null,
        text: r.kind === "answer" ? r.text : null,
        placeholders: (raw.match(/\{(?:fig|web):[a-z0-9_]+\}/g) ?? []).length,
        bareAmounts: (raw.match(/(?:₹|\b(?:rs\.?|inr)\s?)\d|\d[\d,]*\s?(?:lakh|crore)/gi) ?? []).length,
        leftOut: r.kind === "answer" ? r.text.split(UNKNOWN_AMOUNT).length - 1 : 0,
        raw,
        calls: out.calls,
      })
    }
    const summary = {
      runs: rows.length,
      answered: rows.filter((r) => r.kind === "answer").length,
      refused: rows.filter((r) => r.kind === "unverified").length,
      otherFailures: rows.filter((r) => r.kind !== "answer" && r.kind !== "unverified").map((r) => r.kind),
      unmatched: rows.flatMap((r) => r.unmatched),
      creditsSpentNothingShown: rows.filter((r) => r.lookups > 0 && (r.kind !== "answer" || r.kept === 0)).length,
      withWebLine: rows.filter((r) => r.webLine).length,
      placeholdersWritten: rows.reduce((n, r) => n + r.placeholders, 0),
      bareAmountsWritten: rows.reduce((n, r) => n + r.bareAmounts, 0),
      placeholdersLeftOut: rows.reduce((n, r) => n + r.leftOut, 0),
    }
    console.warn(JSON.stringify(summary, null, 2))
    if (process.env.ROMA_LIVE_OUT) writeFileSync(process.env.ROMA_LIVE_OUT, JSON.stringify({ summary, rows }, null, 2))
    expect(rows).toHaveLength(RUNS)
  })
})
