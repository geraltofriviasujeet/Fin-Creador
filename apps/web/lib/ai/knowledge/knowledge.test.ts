import { describe, expect, it } from "vitest"
import { z } from "zod"
import type { UserClient } from "@fin-creador/api"
import { runChat } from "../chat"
import { type MockScript, mockProvider, mockText, mockToolCall } from "../llm/mock"
import { spendingTool } from "../tools/spending"
import { knowledgeSearchTool } from "../tools/knowledge"
import { type FinanceTool, ToolError, type ToolContext } from "../tools/types"
import { progressLine } from "../wording"
import { KNOWLEDGE_UNAVAILABLE, NOT_ADVICE, NO_MATERIAL, NO_MATERIAL_PART, NO_PRODUCT_PICKS, applyCitations, citationOf, knowledgeAnswer, sourceLabel, withoutNotAdvice } from "./citations"
import { axis, mockEmbedder } from "./embedder"
import { isProductPick } from "./picks"
import { routeQuestion } from "./route"
import {
  DEFAULT_MIN_SIMILARITY,
  type KnowledgeDb,
  type KnowledgeRow,
  KnowledgeSession,
  MAX_KNOWLEDGE_SEARCHES,
  type Passage,
  mergeRows,
  queryProblem,
  withinBand,
  withoutAmounts,
} from "./session"

// The knowledge base path (10.6c) on the mock provider and a fake match_knowledge_chunks: no
// test calls the embed function or a paid API.

const row = (over: Partial<KnowledgeRow> = {}): KnowledgeRow => ({
  chunk_id: "00000000-0000-4000-8000-000000000001",
  document_slug: "emergency-fund",
  title: "Building an emergency fund",
  content_kind: "own",
  publisher: "FinCreador",
  based_on_publisher: "RBI",
  source_url: null,
  read_more_url: "https://www.rbi.org.in/",
  link_permission_pending: false,
  financial_year: null,
  content: "Three to six months of essential spending is a commonly used range. Three months of ₹40,000 is ₹1,20,000.",
  similarity: 0.86,
  ...over,
})

const SLABS = row({
  chunk_id: "00000000-0000-4000-8000-000000000002",
  document_slug: "income-tax-old-regime-2026-27",
  title: "Income tax under the old regime, tax year 2026-27",
  based_on_publisher: "Income Tax Department",
  read_more_url: null,
  link_permission_pending: true,
  financial_year: "2026-27",
  content: "Up to ₹2,50,000: nil. ₹2,50,001 to ₹5,00,000: 5%. Above ₹10,00,000: 30%.",
})

function fakeDb(rows: KnowledgeRow[] | Error = [row()]): KnowledgeDb & { calls: { count: number; min: number }[] } {
  const calls: { count: number; min: number }[] = []
  return {
    calls,
    async match(_embedding, count, min) {
      calls.push({ count, min })
      if (rows instanceof Error) throw rows
      return rows
    },
  }
}

const session = (rows: KnowledgeRow[] | Error = [row()], embed = mockEmbedder) => new KnowledgeSession({ embed, db: fakeDb(rows), minSimilarity: 0.8 })

const passage = (over: Partial<Passage> = {}): Passage => ({
  id: "k1",
  chunkId: "c1",
  slug: "emergency-fund",
  title: "Building an emergency fund",
  kind: "own",
  publisher: "FinCreador",
  basedOn: "RBI",
  readMoreUrl: "https://www.rbi.org.in/",
  linkPending: false,
  financialYear: null,
  content: "Text.",
  ...over,
})

describe("routeQuestion", () => {
  it("routes the person's own money to the records and a general question to the knowledge base", () => {
    expect(routeQuestion("How much did I spend last month?")).toBe("records")
    expect(routeQuestion("Can I reach Car 2027?")).toBe("records")
    expect(routeQuestion("What is an SIP?")).toBe("knowledge")
    expect(routeQuestion("What are the old regime tax slabs?")).toBe("knowledge")
    expect(routeQuestion("Explain the difference between direct and regular plans")).toBe("knowledge")
  })

  it("routes a question with both kinds of signal, or none clear, to both", () => {
    expect(routeQuestion("Is my savings rate good?")).toBe("both")
    expect(routeQuestion("Should I prepay my home loan?")).toBe("both")
    expect(routeQuestion("find coffee")).toBe("both")
    expect(routeQuestion("and the other one?")).toBe("both")
    expect(routeQuestion("Hello, what is 80C?")).toBe("knowledge")

    // Hinglish (10.6d): a general question reaches knowledge_search; one about their own money keeps the records.
    expect(routeQuestion("budget kaise banaye mahine ka")).toBe("both")
    expect(routeQuestion("emi kaise calculate hoti hai")).toBe("knowledge")
    expect(routeQuestion("mera kharcha kitna hua is mahine")).toBe("both")
  })

  it("keeps neither for greetings and small talk only", () => {
    for (const q of ["hi", "Hello Roma!", "thanks", "Thank you so much 🙏", "good morning", "ok"]) expect(routeQuestion(q)).toBe("neither")
    expect(routeQuestion("hi, how much did I spend?")).toBe("records")
  })
})

describe("product picks (10.6d)", () => {
  it("detects a question asking which specific product to buy, or what gives the best returns", () => {
    for (const q of [
      "Which mutual fund scheme should I buy for the best returns this year?",
      "Which stock will double next month?",
      "Should I buy Bitcoin or Ethereum now?",
      "which fund is best for me",
      "Best mutual funds for 2027?",
      "top 5 stocks to buy",
      "Can you recommend a good ELSS fund?",
      "suggest some coins",
      "Which term plan should I take?",
      "which health insurance policy should I get",
      "What will give me the best returns?",
      "highest return investment?",
      "which ETF to invest in",
      // Hinglish and coins by name (from the dev evaluation, 2026-11-15)
      "bitcoin abhi kharidu kya?",
      "ethereum lu kya abhi",
      "kaunsa mutual fund lena chahiye",
      "stock kharidna chahiye kya",
      "kaun sa fund best hai 2027 ke liye",
      "konsi policy best hai",
      "will ETH go up this year?",
      "Dogecoin price next month",
      "sell my bitcoin now?",
    ])
      expect(isProductPick(q), q).toBe(true)
  })

  it("leaves general questions, kinds of product and the person's own records alone", () => {
    for (const q of [
      "What is an SIP?",
      "How does a mutual fund work?",
      "What types of mutual funds are there?",
      "Which type of fund suits a 3-year goal?",
      "What is the difference between a direct plan and a regular plan?",
      "How big should a good emergency fund be?",
      "What is the best size for an emergency fund?",
      "Which plan should I choose, old or new regime?",
      "Should I buy a house or rent?",
      "How much did I spend on stocks last month?",
      "Which health insurance policy covers pre-existing diseases?",
      "term vs endowment which is what",
      "kitna cover lena chahiye",
      "kaun sa regime best hai",
      "emergency fund kitna rakhna chahiye",
      "sip kya hota hai",
      "what is a blockchain?",
      "ppf aur nps mein kya fark hai",
    ])
      expect(isProductPick(q), q).toBe(false)
  })

  it("routes a pick to the knowledge base only, so no records tool is offered", () => {
    expect(routeQuestion("Which mutual fund should I buy with my savings?")).toBe("knowledge")
    expect(routeQuestion("Which stock will double next month?")).toBe("knowledge")
  })
})

describe("the progress line (10.6d)", () => {
  it("says records only when a records tool is offered", () => {
    const on = { plan: false, knowledge: true }
    expect(progressLine("How much did I spend last month?", on)).toBe("Roma is checking your records…")
    expect(progressLine("Is my savings rate good?", on)).toBe("Roma is checking your records…")
    expect(progressLine("What is an SIP?", on)).toBe("Roma is working…")
    expect(progressLine("how much tax on 18 lpa?", on)).toBe("Roma is working…")
    expect(progressLine("hi", on)).toBe("Roma is working…")
    expect(progressLine("Plan a bike", { plan: true, knowledge: true })).toBe("Roma is checking your records…")
    expect(progressLine("What is an SIP?", { plan: false, knowledge: false })).toBe("Roma is checking your records…")
  })
})

describe("searching with the model's query and the person's words (10.6d)", () => {
  // Each text embeds to its own axis; the database answers by axis.
  const texts: string[] = []
  const embed = async (text: string) => {
    if (!texts.includes(text)) texts.push(text)
    return axis(texts.indexOf(text))
  }
  const byAxis = (answers: KnowledgeRow[][]): KnowledgeDb & { asked: string[] } => {
    const asked: string[] = []
    return {
      asked,
      async match(vector) {
        const i = vector.indexOf(1)
        asked.push(texts[i]!)
        return answers[i] ?? []
      },
    }
  }
  const at = (n: number, similarity: number) => row({ chunk_id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`, similarity, content: `Passage ${n}.` })

  it("merges both searches, each passage at its best similarity, and embeds the person's words once", async () => {
    texts.length = 0
    const db = byAxis([[at(1, 0.84), at(2, 0.9)], [at(1, 0.88), at(3, 0.87)], [at(4, 0.95)]])
    const s = new KnowledgeSession({ embed, db, minSimilarity: 0.82, ownWords: "80c limit kitna hai for ₹1,50,000?" })
    expect((await s.search("section 80C deduction limit")).map((p) => p.content)).toEqual(["Passage 2.", "Passage 1.", "Passage 3."])
    expect(db.asked).toEqual(["section 80C deduction limit", "80c limit kitna hai for ?"])
    // The second search embeds only its query; the person's words' rows are reused.
    expect((await s.search("tax deduction limits")).map((p) => p.content)).toEqual(["Passage 4."])
    expect(db.asked).toEqual(["section 80C deduction limit", "80c limit kitna hai for ?", "tax deduction limits"])
    expect(s.embeds).toBe(3)
    await expect(s.search("third")).rejects.toThrow(ToolError)
    expect(mergeRows([[at(1, 0.8)], [at(1, 0.9), at(2, 0.85)]]).map((r) => r.similarity)).toEqual([0.9, 0.85])
  })

  it("searches with the person's words alone when the query can't be used, and refuses with neither", async () => {
    texts.length = 0
    const db = byAxis([[at(1, 0.9)]])
    const s = new KnowledgeSession({ embed, db, minSimilarity: 0.82, ownWords: "sip kya hota hai" })
    expect((await s.search(null)).map((p) => p.content)).toEqual(["Passage 1."])
    expect(db.asked).toEqual(["sip kya hota hai"])
    await expect(new KnowledgeSession({ embed, db, minSimilarity: 0.82 }).search(null)).rejects.toThrow(ToolError)
  })

  it("takes amounts out of the person's words, keeping section numbers and years", () => {
    expect(withoutAmounts("my salary is 14.15 lakh, ₹1,20,000 bonus and 18 LPA, rs 5000, 1415000 in 2026 under 80C for 2026-27")).toBe(
      "my salary is , bonus and , , in 2026 under 80C for 2026-27",
    )
  })

  it("refuses a query holding an amount or a name the records returned, and nothing else", () => {
    expect(queryProblem("tax on 18 lpa salary", [])).toBe("amount")
    expect(queryProblem("is ₹5,000 a month enough", [])).toBe("amount")
    expect(queryProblem("emergency fund for the Goa Trip goal", ["Goa Trip", "this_month", "ok"])).toBe("records")
    expect(queryProblem("section 80C deduction limit 2026-27", ["Goa Trip", "this_month"])).toBeNull()
    expect(queryProblem("goat farming loans", ["Goa"])).toBeNull()
  })

  it("never sends a query with a records name: the chat loop hands the records' strings to knowledge_search", async () => {
    texts.length = 0
    const db = byAxis([[at(1, 0.9)]])
    const goals = { name: "goal_projection", description: "", input: z.object({}), run: async () => ({ data: { goal: "Goa Trip" }, figures: [] }) } as unknown as FinanceTool
    const run = await runChat({
      provider: mockProvider((_req, round) =>
        round === 0 ? mockToolCall("goal_projection", {}) : round === 1 ? mockToolCall("knowledge_search", { query: "emergency fund before the Goa Trip" }) : mockText("Keep three to six months [[k1]]."),
      ),
      tools: [goals, knowledgeSearchTool as FinanceTool],
      context: { ...base, knowledge: new KnowledgeSession({ embed, db, minSimilarity: 0.82, ownWords: "how big should my emergency fund be" }) },
      question: "how big should my emergency fund be",
      route: "both",
    })
    expect(db.asked).toEqual(["how big should my emergency fund be"])
    expect(run.result.kind).toBe("answer")
  })
})

describe("KnowledgeSession", () => {
  it("keeps only passages within 0.05 of the top one, at the 0.85 default floor", async () => {
    expect(DEFAULT_MIN_SIMILARITY).toBe(0.85)
    const at = (similarity: number, n: number) => row({ chunk_id: `00000000-0000-4000-8000-00000000001${n}`, similarity })
    expect(withinBand([at(0.91, 1), at(0.86, 2), at(0.859, 3), at(0.83, 4)]).map((r) => r.similarity)).toEqual([0.91, 0.86])
    expect(withinBand([])).toEqual([])
    const s = session([at(0.9, 1), at(0.84, 2)])
    expect((await s.search("emergency fund")).map((p) => p.id)).toEqual(["k1"])
    expect(s.passages).toHaveLength(1)
  })

  it("keeps one id per passage across searches and refuses a fourth search before any call", async () => {
    const db = fakeDb([row(), SLABS])
    const s = new KnowledgeSession({ embed: mockEmbedder, db, minSimilarity: 0.8 })
    expect((await s.search("emergency fund size")).map((p) => p.id)).toEqual(["k1", "k2"])
    expect((await s.search("emergency fund again")).map((p) => p.id)).toEqual(["k1", "k2"])
    await s.search("third")
    await expect(s.search("fourth")).rejects.toThrow(ToolError)
    expect(db.calls).toEqual(Array(MAX_KNOWLEDGE_SEARCHES).fill({ count: 4, min: 0.8 }))
    expect(s.passages).toHaveLength(2)
  })

  it("turns an embedding or database failure into a plain tool error, and remembers it", async () => {
    const s = session(new Error("down"))
    await expect(s.search("q")).rejects.toThrow("couldn't be searched")
    expect(s.allFailed).toBe(true)
    const failing = new KnowledgeSession({ embed: async () => Promise.reject(new Error("403")), db: fakeDb(), minSimilarity: 0.8 })
    await expect(failing.search("q")).rejects.toThrow(ToolError)
  })

  it("the mock embedder puts crypto questions where nothing lies", async () => {
    expect(await mockEmbedder("What is an SIP?")).toEqual(axis(0))
    expect(await mockEmbedder("Should I buy Bitcoin?")).toEqual(axis(1))
  })
})

describe("citations", () => {
  it("labels own explainers and official text, and links only what the publisher allows", () => {
    expect(sourceLabel({ kind: "own", publisher: "FinCreador", basedOn: "SEBI" })).toBe("FinCreador explainer, based on SEBI")
    expect(sourceLabel({ kind: "official", publisher: "AMFI", basedOn: null })).toBe("From AMFI")
    expect(citationOf([passage()], 1, "2026-11-14")).toEqual({
      n: 1,
      title: "Building an emergency fund",
      source: "FinCreador explainer, based on RBI",
      url: "https://www.rbi.org.in/",
      passages: ["Text."],
    })
    expect(citationOf([passage({ linkPending: true, readMoreUrl: null })], 1, "2026-11-14")).toMatchObject({ linkPending: true })
    expect(citationOf([passage({ linkPending: true })], 1, "2026-11-14").url).toBeUndefined()
    expect(citationOf([passage({ readMoreUrl: null })], 1, "2026-11-14").url).toBeUndefined()
    expect(citationOf([passage({ readMoreUrl: "javascript:alert(1)" })], 1, "2026-11-14").url).toBeUndefined()
  })

  it("shows the financial year, and marks it out of date once it has ended in the person's today", () => {
    const fy = passage({ financialYear: "2026-27" })
    expect(citationOf([fy], 1, "2027-03-31")).toMatchObject({ financialYear: "2026-27" })
    expect(citationOf([fy], 1, "2027-03-31").outOfDate).toBeUndefined()
    expect(citationOf([fy], 1, "2027-04-01")).toMatchObject({ financialYear: "2026-27", outOfDate: true })
  })

  it("numbers cited ids in order of first use and drops ids that weren't retrieved", () => {
    const passages = [passage(), passage({ id: "k2", chunkId: "c2", slug: "other-document" })]
    const { text, cited } = applyCitations("A [[k2]]. B [[k9]]. C [[K1]] and again [[k2]].", passages)
    expect(text).toBe("A [1]. B. C [2] and again [1].")
    expect(cited.map((p) => p.id)).toEqual(["k2", "k1"])
  })

  it("lists a document once, with each of its cited passages under one number", () => {
    const passages = [passage({ content: "Slabs." }), passage({ id: "k2", chunkId: "c2", content: "Rebate." }), passage({ id: "k3", chunkId: "c3", slug: "other-document", title: "Other" })]
    const { text, documents } = applyCitations("A [[k1]]. B [[k3]]. C [[k2]].", passages)
    expect(text).toBe("A [1]. B [2]. C [1].")
    expect(documents.map((d) => d.map((p) => p.id))).toEqual([["k1", "k2"], ["k3"]])
    expect(citationOf(documents[0]!, 1, "2026-11-14")).toMatchObject({ n: 1, title: "Building an emergency fund", passages: ["Slabs.", "Rebate."] })
  })

  it("replaces a general answer with no cited passage, and keeps a records answer when the general part found nothing", async () => {
    const none = session([])
    await none.search("crypto")
    expect(knowledgeAnswer("Bitcoin is ₹50,00,000.", none, "knowledge", "2026-11-14")).toEqual({ replace: NO_MATERIAL })
    expect(knowledgeAnswer("You spent ₹500.", none, "both", "2026-11-14")).toEqual({ text: "You spent ₹500.", citations: [], numbers: [], tail: NO_MATERIAL_PART })
    const found = session()
    await found.search("emergency fund")
    expect(knowledgeAnswer("Uncited text.", found, "knowledge", "2026-11-14")).toEqual({ replace: NO_MATERIAL })
    expect(knowledgeAnswer("Not searched.", session(), "knowledge", "2026-11-14")).toEqual({ replace: NO_MATERIAL })
    const failed = session(new Error("down"))
    await failed.search("q").catch(() => null)
    expect(knowledgeAnswer("x", failed, "knowledge", "2026-11-14")).toEqual({ replace: KNOWLEDGE_UNAVAILABLE })
  })
})

// The chat loop with knowledge_search over a fake database.
const supabase = {
  rpc: async () => ({
    data: [{ currency: "INR", income_minor: 0, expense_minor: 50000, refund_minor: 0, income_count: 0, expense_count: 2, refund_count: 0, transfer_count: 0 }],
    error: null,
  }),
} as unknown as UserClient
const base: ToolContext = { supabase, today: "2026-11-14", currency: "INR", descriptionsOk: false }
const knowledgeOnly = [knowledgeSearchTool as FinanceTool]
const both = [spendingTool as FinanceTool, knowledgeSearchTool as FinanceTool]

/** Calls knowledge_search, then answers with `answer`. */
const searchThen =
  (answer: string): MockScript =>
  (_req, round) =>
    round === 0 ? mockToolCall("knowledge_search", { query: "How big should an emergency fund be?" }) : mockText(answer)

const askKnowledge = (script: MockScript, rows: KnowledgeRow[] | Error = [row(), SLABS], extra: Partial<Parameters<typeof runChat>[0]> = {}) =>
  runChat({ provider: mockProvider(script), tools: knowledgeOnly, context: { ...base, knowledge: session(rows) }, question: "How big should an emergency fund be?", route: "knowledge", ...extra })

describe("Roma's chat loop with the knowledge base", () => {
  it("shows a cited answer with its citations, lets it quote the cited passage's figures, and ends with the notice", async () => {
    const run = await askKnowledge(searchThen("Three to six months of essential spending is common; three months of ₹40,000 is ₹1,20,000 [[k1]]."))
    expect(run.result).toMatchObject({
      kind: "answer",
      text: `Three to six months of essential spending is common; three months of ₹40,000 is ₹1,20,000 [1].\n\n${NOT_ADVICE}`,
      toolsRan: ["knowledge_search"],
      citations: [{ n: 1, title: "Building an emergency fund", source: "FinCreador explainer, based on RBI", url: "https://www.rbi.org.in/" }],
    })
    expect(run.result.kind === "answer" && run.result.citations?.[0]?.passages.join("\n")).toContain("₹1,20,000")
  })

  it("refuses a figure from a passage the answer doesn't cite, and one from nowhere", async () => {
    // 30% is in the slabs passage (k2), which this answer doesn't cite.
    const uncited = await askKnowledge(searchThen("Keep three to six months [[k1]]; the top rate is 30%."))
    expect(uncited.result).toEqual({ kind: "unverified", unmatched: ["30"] })
    const computed = await askKnowledge(searchThen("Six months of ₹40,000 is ₹2,40,000 [[k1]]."))
    expect(computed.result).toEqual({ kind: "unverified", unmatched: ["240000"] })
  })

  it("lets a slab be quoted from its cited passage, in lakh as well", async () => {
    const run = await askKnowledge(searchThen("Income above ₹10 lakh is taxed at 30% under the old regime for FY 2026-27 [[k2]]."))
    expect(run.result).toMatchObject({ kind: "answer", citations: [{ financialYear: "2026-27" }] })
    expect(run.result.kind === "answer" && run.result.citations?.[0]?.url).toBeUndefined()
  })

  it("replaces a general answer when nothing is above the floor, whatever the model wrote", async () => {
    const run = await askKnowledge(searchThen("From memory: Bitcoin is worth ₹50,00,000."), [])
    expect(run.result).toMatchObject({ kind: "answer", text: NO_MATERIAL, figures: [] })
    expect(JSON.stringify(run.result)).not.toContain("50,00,000")
  })

  it("puts the no-picks line before a cited explanation of a product pick", async () => {
    const question = "Which mutual fund should I buy for the best returns?"
    const cited = await askKnowledge(searchThen("Fund X is best. An emergency fund covers three to six months [[k1]]."), [row()], { question })
    expect(cited.result).toMatchObject({ kind: "answer", text: `${NO_PRODUCT_PICKS}\n\nFund X is best. An emergency fund covers three to six months [1].\n\n${NOT_ADVICE}` })
    expect(cited.result.kind === "answer" && cited.result.text.startsWith(NO_PRODUCT_PICKS)).toBe(true)
  })

  it("answers a product pick with the no-picks line alone when no passage is cited", async () => {
    const question = "Which stock will double next month?"
    for (const rows of [[], [row()]]) {
      const run = await askKnowledge(searchThen("Buy Stock Y now."), rows, { question })
      expect(run.result).toMatchObject({ kind: "answer", text: NO_PRODUCT_PICKS, figures: [] })
    }
    // With the knowledge base off, a records answer is not shown for a pick either.
    const off = await runChat({ provider: mockProvider(() => mockText("Buy Stock Y.")), tools: [spendingTool as FinanceTool], context: base, question })
    expect(off.result).toMatchObject({ kind: "answer", text: NO_PRODUCT_PICKS })
  })

  it("answers the records part of a mixed question and says the general part has no vetted material", async () => {
    const run = await runChat({
      provider: mockProvider((_req, round) =>
        round === 0
          ? { stop: "tool_use", text: "", toolCalls: [{ id: "a", name: "spending_for_period", input: { period: "this_month" } }, { id: "b", name: "knowledge_search", input: { query: "Is crypto a good investment?" } }], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }
          : mockText("You spent ₹500.00 this month."),
      ),
      tools: both,
      context: { ...base, knowledge: session([]) },
      question: "I spent on crypto this month, is crypto good?",
      route: "both",
    })
    expect(run.result).toMatchObject({ kind: "answer", text: `You spent ₹500.00 this month.\n\n${NO_MATERIAL_PART}` })
  })

  it("on the small-talk route, refuses any money figure as before", async () => {
    const run = await runChat({ provider: mockProvider(() => mockText("Hi! The 80C limit is ₹1,50,000.")), tools: [], context: base, question: "hi", route: "neither" })
    expect(run.result).toEqual({ kind: "unverified", unmatched: ["150000"] })
  })

  it("sends the knowledge rules and the route only when knowledge_search is offered, and passages as delimited untrusted text", async () => {
    let system: string[] = []
    let result = ""
    await askKnowledge((req, round) => {
      system = req.system
      if (round === 0) return mockToolCall("knowledge_search", { query: "emergency fund size" })
      const last = req.messages.at(-1)
      result = last?.role === "tool_results" ? last.results[0]!.content : ""
      return mockText("ok")
    })
    expect(system.some((b) => b.startsWith("Knowledge base:"))).toBe(true)
    expect(system[1]).toContain("This is a general question")
    expect(JSON.parse(result).passages[0]).toMatchObject({ id: "k1", text: expect.stringMatching(/^<passage k1>\n[\s\S]*\n<\/passage k1>$/) })
    let records: string[] = []
    await runChat({ provider: mockProvider((req) => ((records = req.system), mockText("ok"))), tools: [spendingTool as FinanceTool], context: base, question: "q" })
    expect(records.some((b) => b.startsWith("Knowledge base:"))).toBe(false)
  })

  it.each([
    "Three to six months of essential spending is common [[k1]].\n\nGeneral information, not personal advice.",
    "Three to six months of essential spending is common [[k1]]. General information, not personal advice.",
    "Three to six months of essential spending is common [[k1]].\n\n(This is general information, not financial advice.)",
  ])("prints the not-advice line once, from code, when the model wrote it too: %j", async (written) => {
    const run = await askKnowledge(searchThen(written))
    expect(run.result).toMatchObject({ kind: "answer", text: `Three to six months of essential spending is common [1].\n\n${NOT_ADVICE}` })
    expect(run.result.kind === "answer" && run.result.text.match(/not (?:personal|financial) advice/gi)).toHaveLength(1)
  })

  it("removes the model's not-advice line from an answer that cites nothing", () => {
    expect(withoutNotAdvice("You spent ₹500.\n\nGeneral information, not personal advice.")).toBe("You spent ₹500.")
    expect(withoutNotAdvice("Advice depends on you.")).toBe("Advice depends on you.")
  })

  it("the mock provider's general flow quotes and cites the first passage", async () => {
    const run = await askKnowledge(undefined as unknown as MockScript, [row()], { provider: mockProvider() })
    expect(run.result).toMatchObject({ kind: "answer", text: `Three to six months of essential spending is a commonly used range. [1] (Test answer.)\n\n${NOT_ADVICE}` })
  })
})
