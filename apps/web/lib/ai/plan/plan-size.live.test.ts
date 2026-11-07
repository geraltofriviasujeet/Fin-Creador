import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { UserClient } from "@fin-creador/api"
import { anthropicProvider } from "../llm/anthropic"
import { type SearchDb, WebSession } from "../search/session"
import { tavilyProvider } from "../search/tavily"
import { pickInput, runPlan } from "./run"
import { checkedPlanSchema } from "./types"

// One real plan, measured against ai_messages.plan's checks (size, top-level keys, blocked keys).
// Spends 8 Tavily credits and one model call, so by hand only: PLAN_SIZE=1 npx vitest run apps/web/lib/ai/plan/plan-size.live.test.ts

const run = process.env.PLAN_SIZE === "1" && !process.env.CI
const env = (name: string) => {
  const line = readFileSync(join(__dirname, "../../../.env.local"), "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
  return line!.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
}
const db: SearchDb = { begin: async () => ({ outcome: "ok", credits: 8 }), settle: async () => true, release: async () => true }

describe.skipIf(!run)("a real plan against the stored-plan checks (by hand only)", () => {
  it("measures one Goa plan", { timeout: 120_000 }, async () => {
    const web = new WebSession({ provider: tavilyProvider({ apiKey: env("TAVILY_API_KEY") }), db, requestId: "size", terms: { names: [], phrases: [] }, countryCode: "IN", plan: true })
    const ctx = { supabase: {} as UserClient, today: "2026-11-07", currency: "INR", descriptionsOk: false, web }
    const real = anthropicProvider({ apiKey: env("ANTHROPIC_API_KEY"), model: env("LLM_MODEL") })
    const out = await runPlan(
      { kind: "trip", destination: "Goa", origin: "Delhi", month: "2027-01", nights: 4, travellers: 2, style: "comfort" },
      { ctx, provider: { ...real, complete: async (r, sig) => { const res = await real.complete(r, sig).catch((e) => { console.warn(JSON.stringify({ error: String(e), kind: e.kind, cause: String(e.cause ?? '') })); throw e }); const call = res.toolCalls[0]; console.warn(JSON.stringify({ out: res.usage.outputTokens, stop: res.stop, tool: call?.name, text: res.text.slice(0, 300), input: String(JSON.stringify(call?.input)).slice(0, 1500), issues: call ? pickInput.safeParse(call.input).error?.issues.slice(0, 5) : null })); return res } }, records: async () => ({ records: { verdict: "No verdict.", summary: "Test." }, goal: null, saved: null, project: null, assumptions: [] }) },
    )
    const text = JSON.stringify(out.plan)
    const keys: string[] = []
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x) }
    }
    walk(out.plan)
    const urls = text.match(/https:\/\/[^"]+/g) ?? []
    console.warn(JSON.stringify({
      bytes: Buffer.byteLength(text), picked: out.picked, sources: out.plan.sources.length,
      urls: urls.length, longestUrl: Math.max(...urls.map((u) => u.length)), urlBytes: urls.reduce((n, u) => n + u.length, 0),
      blocked: keys.filter((k) => /account|account_no|iban|ifsc|card_number|balance/i.test(k)),
      schema: checkedPlanSchema.safeParse(out.plan).success,
      transport: out.plan.lines.find((l) => l.line === "transport")?.how, carriers: out.plan.carriers?.listed.map((c) => c.name), carrierNote: out.plan.carriers?.note,
    }))
    expect(out.plan.v).toBe(1)
  })
})
