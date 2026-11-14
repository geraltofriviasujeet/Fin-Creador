import { ToolError } from "../tools/types"

// One question's knowledge base searches (Sprint 10.6c). The question is embedded by the embed
// Edge Function under the question's own roma_usage reservation (roma_knowledge_embed allows 3
// per question; the same cap is kept here, so a fourth is refused before any call), then
// match_knowledge_chunks returns the closest approved passages at or above the floor. Each
// passage gets a short id for the model to cite ("k1"); the same passage found twice keeps its
// id. Passages are untrusted reference text: never instructions, never a figure source unless
// the answer cites them (chat.ts). From 10.6d only the passages within SIMILARITY_BAND of the
// top one are kept, so unrelated tail passages that clear the floor are not sent to the model.
// From 10.6d (retrieval) a search is made with two texts: the model's query (plain English,
// abbreviations expanded, Hinglish translated) and the person's own words with amounts taken
// out, embedded once per question and reused; each passage keeps its best similarity. The cap
// counts embeddings: 3 per question, as roma_knowledge_embed allows. A query holding an amount,
// or a name or other text the records tools returned, is not used (queryProblem): the search
// then uses the person's words only.

export const MAX_KNOWLEDGE_SEARCHES = 3
/** Embeddings per question: roma_knowledge_embed's cap (20261113120000). */
export const MAX_KNOWLEDGE_EMBEDS = 3
/** Passages per search: match_knowledge_chunks allows up to 8. */
export const KNOWLEDGE_COUNT = 4
/** The floor, tuned with scripts/knowledge-eval.ts on dev (10.6d). */
export const DEFAULT_MIN_SIMILARITY = 0.82
/** Passages kept: those within this much of the search's top similarity. */
export const SIMILARITY_BAND = 0.05

/** A row of match_knowledge_chunks (20261113120000_knowledge_embed.sql). */
export type KnowledgeRow = {
  chunk_id: string
  document_slug: string
  title: string
  content_kind: string
  publisher: string
  based_on_publisher: string | null
  source_url: string | null
  read_more_url: string | null
  link_permission_pending: boolean
  financial_year: string | null
  content: string
  similarity: number
}

export type Passage = {
  id: string
  chunkId: string
  slug: string
  title: string
  kind: "official" | "own"
  publisher: string
  basedOn: string | null
  readMoreUrl: string | null
  linkPending: boolean
  financialYear: string | null
  content: string
}

export type KnowledgeDb = {
  /** match_knowledge_chunks under the person's session; throws when it fails. */
  match(embedding: number[], count: number, minSimilarity: number): Promise<KnowledgeRow[]>
}

/** One embedding of the question (384 numbers); throws when it can't be made. */
export type Embedder = (text: string) => Promise<number[]>

export class KnowledgeSession {
  readonly passages: Passage[] = []
  searches = 0
  failures = 0
  embeds = 0
  /** The person's own words' rows: undefined until embedded (once per question). */
  private own: KnowledgeRow[] | undefined

  constructor(
    private readonly options: {
      embed: Embedder
      db: KnowledgeDb
      minSimilarity: number
      count?: number
      /** The person's question, as typed: searched beside the model's query (amounts taken out). */
      ownWords?: string
    },
  ) {}

  /** Whether every search made failed (nothing to say about coverage). */
  get allFailed(): boolean {
    return this.searches > 0 && this.failures === this.searches
  }

  /** Searches with the model's query (null: not usable) and the person's own words. */
  async search(query: string | null): Promise<Passage[]> {
    const own = this.options.ownWords ? withoutAmounts(this.options.ownWords) : ""
    const ownPending = this.own === undefined && own.length >= 3
    if (this.searches >= MAX_KNOWLEDGE_SEARCHES || this.embeds >= MAX_KNOWLEDGE_EMBEDS) {
      throw new ToolError(`At most ${MAX_KNOWLEDGE_SEARCHES} knowledge searches per question. Answer from the passages found.`)
    }
    if (query === null && !ownPending && this.own === undefined) throw new ToolError("Write the query in plain words, with no amounts or names from the person's records.")
    this.searches++
    const count = this.options.count ?? KNOWLEDGE_COUNT
    let tried = 0
    let failed = 0
    const rowsFor = async (text: string): Promise<KnowledgeRow[] | null> => {
      tried++
      this.embeds++
      try {
        return await this.options.db.match(await this.options.embed(text), count, this.options.minSimilarity)
      } catch {
        failed++
        return null
      }
    }
    const lists: KnowledgeRow[][] = []
    // The model's query first: with one embedding left, it is the one made.
    if (query !== null) lists.push((await rowsFor(query)) ?? [])
    if (ownPending && this.embeds < MAX_KNOWLEDGE_EMBEDS) this.own = (await rowsFor(own)) ?? []
    if (this.own) lists.push(this.own)
    if (tried > 0 && failed === tried) {
      this.failures++
      throw new ToolError("The knowledge base couldn't be searched just now. Don't answer the general part from memory.")
    }
    return withinBand(mergeRows(lists).slice(0, count)).flatMap((row) => {
      if (row.content_kind !== "official" && row.content_kind !== "own") return []
      const known = this.passages.find((p) => p.chunkId === row.chunk_id)
      if (known) return [known]
      const passage: Passage = {
        id: `k${this.passages.length + 1}`,
        chunkId: row.chunk_id,
        slug: row.document_slug,
        title: row.title,
        kind: row.content_kind,
        publisher: row.publisher,
        basedOn: row.based_on_publisher,
        readMoreUrl: row.read_more_url,
        linkPending: row.link_permission_pending,
        financialYear: row.financial_year,
        content: row.content,
      }
      this.passages.push(passage)
      return [passage]
    })
  }
}

/** The rows within SIMILARITY_BAND of the top one (at most KNOWLEDGE_COUNT, as the search asked). */
export function withinBand(rows: readonly KnowledgeRow[]): KnowledgeRow[] {
  const top = Math.max(...rows.map((r) => r.similarity))
  // Rounded to the database's precision, so a passage at exactly the band's edge is kept.
  return rows.filter((r) => Math.round((top - r.similarity) * 1e6) <= SIMILARITY_BAND * 1e6)
}

/** Rows from several searches: each passage once, at its best similarity, closest first. */
export function mergeRows(lists: readonly (readonly KnowledgeRow[])[]): KnowledgeRow[] {
  const best = new Map<string, KnowledgeRow>()
  for (const row of lists.flat()) {
    const seen = best.get(row.chunk_id)
    if (!seen || row.similarity > seen.similarity) best.set(row.chunk_id, row)
  }
  return [...best.values()].sort((a, b) => b.similarity - a.similarity)
}

/** The text with amounts taken out: currency-marked, lakh / crore / k / lpa, grouped or decimal numbers, and numbers of 4 or more digits other than years. */
export function withoutAmounts(text: string): string {
  return text
    .replace(/(?:[₹$€£]|\b(?:rs|inr|usd)\.?)\s*\d(?:[\d,]*\d)?(?:\.\d+)?/gi, " ")
    .replace(/\b\d(?:[\d,]*\d)?(?:\.\d+)?\s*(?:lakhs?|lacs?|crores?|cr|k|lpa|rupees?)\b/gi, " ")
    .replace(/\b\d[\d,]*\.\d+\b|\b\d{1,3}(?:,\d{2,3})+\b/g, " ")
    .replace(/\b\d{4,}\b/g, (n) => (n.length === 4 && Number(n) >= 1900 && Number(n) <= 2100 ? n : " "))
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Why the model's query can't be sent, or null: it holds an amount, or a name or other text the
 * records tools returned this question (whole words, any case; codes such as "this_month" and
 * strings under 3 characters are not names).
 */
export function queryProblem(query: string, recordStrings: readonly string[]): "amount" | "records" | null {
  if (withoutAmounts(query) !== query.replace(/\s+/g, " ").trim()) return "amount"
  for (const raw of recordStrings) {
    const name = raw.trim()
    if (name.length < 3 || /^[a-z0-9_]+$/.test(name)) continue
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(query)) return "records"
  }
  return null
}
