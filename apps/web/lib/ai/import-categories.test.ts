import { describe, expect, it } from "vitest"
import type { LlmConfig } from "./config"
import { SUGGEST_BATCH_SIZE, type SuggestBeginOutcome, type SuggestDb, nameToSend, readSuggestions, suggestCategories } from "./import-categories"
import { mockProvider, mockToolCall } from "./llm/mock"
import { LlmError, type LlmRequest } from "./llm/types"

// Import category suggestions (Sprint 9e) on the mock provider only: no paid API is ever called.
// Payee names are invented.

const on: LlmConfig = { status: "on", provider: "mock", model: "mock", apiKey: null }

function fakeDb(outcomes: SuggestBeginOutcome[] = []) {
  const calls: string[] = []
  let n = 0
  const db: SuggestDb = {
    async begin() {
      const outcome = outcomes[n] ?? "ok"
      n++
      calls.push(`begin:${outcome}`)
      return { outcome, requestId: outcome === "ok" ? `req-${n}` : null }
    },
    async settle(id, i, o, cost) {
      calls.push(`settle:${id}:${i}:${o}:${cost}`)
      return true
    },
    async release(id) {
      calls.push(`release:${id}`)
      return true
    },
  }
  return { db, calls }
}

const names = (count: number, name = (i: number) => `Payee ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`) =>
  Array.from({ length: count }, (_, i) => ({ id: i.toString(36), name: name(i) }))

describe("what is sent", () => {
  it("cleans names again and drops the person's own name", () => {
    expect(nameToSend("Green Leaf Cafe greenleaf@okexample 9000000042", null)).toBe("Green Leaf Cafe")
    expect(nameToSend("asha.example@example.test", null)).toBeNull()
    expect(nameToSend("Asha Example", "asha  example")).toBeNull()
    expect(nameToSend("Corner Store", "Asha Example")).toBe("Corner Store")
  })

  it("sends payee names with short ids and the key list only: no amounts, dates or accounts", async () => {
    const seen: LlmRequest[] = []
    const { db } = fakeDb()
    await suggestCategories({
      config: on,
      db,
      ownName: "Asha Example",
      names: [{ id: "0", name: "Green Leaf Cafe" }, { id: "1", name: "Asha Example" }],
      makeProvider: () =>
        mockProvider((request) => {
          seen.push(request)
          return mockToolCall("set_categories", { items: [] })
        }),
    })
    expect(seen).toHaveLength(1)
    const user = seen[0]!.messages[0]!
    expect(user).toEqual({ role: "user", text: "0: Green Leaf Cafe" })
    expect(seen[0]!.system.join("\n")).toContain("money_sent")
    expect(JSON.stringify(seen[0])).not.toMatch(/Asha|₹|Rs\.|20\d\d-\d\d|XX\d/)
  })
})

describe("the reply", () => {
  it("keeps keys from the list for ids in the batch; ignores an invalid key, an unknown id and a repeat", () => {
    const ids = new Set(["0", "1", "2"])
    expect(readSuggestions({ items: [{ id: "0", key: "food" }, { id: "1", key: "not_a_key" }, { id: "9", key: "food" }, { id: "0", key: "travel" }, { id: "2", key: 7 }] }, ids)).toEqual({ "0": "food" })
    expect(readSuggestions("garbage", ids)).toEqual({})
  })

  it("on the default mock: suggestions from the words, the invalid key dropped", async () => {
    const { db, calls } = fakeDb()
    const result = await suggestCategories({
      config: on,
      db,
      ownName: null,
      names: [{ id: "0", name: "Blue Kitchen" }, { id: "1", name: "Hill Mart" }, { id: "2", name: "ZZ Invalid Traders" }],
      makeProvider: () => mockProvider(),
    })
    expect(result).toEqual({ suggestions: { "0": "food", "1": "groceries" }, rulesOnly: null, calls: 1 })
    expect(calls).toEqual(["begin:ok", "settle:req-1:0:0:0"])
  })
})

describe("batches, caps and failures", () => {
  it(`sends ${SUGGEST_BATCH_SIZE} names per call, one reservation each`, async () => {
    const { db, calls } = fakeDb()
    const result = await suggestCategories({ config: on, db, ownName: null, names: names(250), makeProvider: () => mockProvider() })
    expect(result.calls).toBe(3)
    expect(Object.keys(result.suggestions)).toHaveLength(250)
    expect(calls.filter((c) => c.startsWith("begin"))).toHaveLength(3)
  })

  it("a refusal at the cap stops: earlier batches keep their suggestions, the rest are rules only", async () => {
    const { db, calls } = fakeDb(["ok", "user_budget"])
    const result = await suggestCategories({ config: on, db, ownName: null, names: names(150), makeProvider: () => mockProvider() })
    expect(result.rulesOnly).toBe("user_budget")
    expect(Object.keys(result.suggestions)).toHaveLength(100)
    expect(calls).toEqual(["begin:ok", "settle:req-1:0:0:0", "begin:user_budget"])
  })

  it.each(["disabled", "no_consent", "daily_limit"] as const)("%s: nothing is sent", async (outcome) => {
    const { db } = fakeDb([outcome])
    let sent = 0
    const result = await suggestCategories({ config: on, db, ownName: null, names: names(3), makeProvider: () => mockProvider(() => (sent++, mockToolCall("set_categories", { items: [] }))) })
    expect(result).toEqual({ suggestions: {}, rulesOnly: outcome, calls: 0 })
    expect(sent).toBe(0)
  })

  it("not configured (CI without a key): rules only, no database call", async () => {
    const { db, calls } = fakeDb()
    const result = await suggestCategories({ config: { status: "off", reason: "ci" }, db, ownName: null, names: names(3), makeProvider: () => mockProvider() })
    expect(result.rulesOnly).toBe("off")
    expect(calls).toEqual([])
  })

  it("a call refused by the provider is released; one that may have been sent is charged at the worst case", async () => {
    const refused = fakeDb()
    const r1 = await suggestCategories({
      config: on, db: refused.db, ownName: null, names: names(3),
      makeProvider: () => mockProvider(() => { throw new LlmError("rejected", "no", "bad request") }),
    })
    expect(r1.rulesOnly).toBe("failed")
    expect(refused.calls).toEqual(["begin:ok", "release:req-1"])

    const timedOut = fakeDb()
    await suggestCategories({
      config: { status: "on", provider: "anthropic", model: "claude-haiku-5-5", apiKey: "test" }, db: timedOut.db, ownName: null, names: names(3),
      makeProvider: () => mockProvider(() => { throw new LlmError("timeout", "unknown", "timed out") }),
    })
    expect(timedOut.calls[1]).toMatch(/^settle:req-1:0:0:0\.00[0-9]+$/)
  })
})
