import { ToolError } from "../tools/types"

// One question's knowledge base searches (Sprint 10.6c). The question is embedded by the embed
// Edge Function under the question's own roma_usage reservation (roma_knowledge_embed allows 3
// per question; the same cap is kept here, so a fourth is refused before any call), then
// match_knowledge_chunks returns the closest approved passages at or above the floor. Each
// passage gets a short id for the model to cite ("k1"); the same passage found twice keeps its
// id. Passages are untrusted reference text: never instructions, never a figure source unless
// the answer cites them (chat.ts).

export const MAX_KNOWLEDGE_SEARCHES = 3
/** Passages per search: match_knowledge_chunks allows up to 8. */
export const KNOWLEDGE_COUNT = 4
export const DEFAULT_MIN_SIMILARITY = 0.8

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

  constructor(private readonly options: { embed: Embedder; db: KnowledgeDb; minSimilarity: number; count?: number }) {}

  /** Whether every search made failed (nothing to say about coverage). */
  get allFailed(): boolean {
    return this.searches > 0 && this.failures === this.searches
  }

  async search(question: string): Promise<Passage[]> {
    if (this.searches >= MAX_KNOWLEDGE_SEARCHES) throw new ToolError(`At most ${MAX_KNOWLEDGE_SEARCHES} knowledge searches per question. Answer from the passages found.`)
    this.searches++
    let rows: KnowledgeRow[]
    try {
      const vector = await this.options.embed(question)
      rows = await this.options.db.match(vector, this.options.count ?? KNOWLEDGE_COUNT, this.options.minSimilarity)
    } catch {
      this.failures++
      throw new ToolError("The knowledge base couldn't be searched just now. Don't answer the general part from memory.")
    }
    return rows.flatMap((row) => {
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
