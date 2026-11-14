import type { Embedder } from "./session"

// The question's embedding (Sprint 10.6c): the deployed embed Edge Function, called with the
// person's own token and the question's roma_usage reservation, so roma_knowledge_embed applies
// the kill switch, the caps and 3 embeddings per question. The mock (tests and the E2E server)
// returns fixed unit vectors and never calls anything.

export const DIMENSIONS = 384

export function functionEmbedder(o: { supabaseUrl: string; anonKey: string; accessToken: string; requestId: string }): Embedder {
  return async (text) => {
    const response = await fetch(`${o.supabaseUrl.replace(/\/+$/, "")}/functions/v1/embed`, {
      method: "POST",
      headers: { Authorization: `Bearer ${o.accessToken}`, apikey: o.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [text], request_id: o.requestId }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) throw new Error(`embed ${response.status}`)
    const body = (await response.json()) as { embeddings?: unknown }
    const vector = Array.isArray(body.embeddings) ? body.embeddings[0] : null
    if (!Array.isArray(vector) || vector.length !== DIMENSIONS || !vector.every((v) => typeof v === "number" && Number.isFinite(v))) throw new Error("bad vector")
    return vector as number[]
  }
}

/** A unit vector along one axis. */
export const axis = (i: number) => Array.from({ length: DIMENSIONS }, (_, j) => (j === i ? 1 : 0))

/**
 * Test only: every question is axis 0, where the E2E fixture's passage lies; a question about
 * crypto is axis 1, where nothing lies, so it finds nothing above any floor.
 */
export const mockEmbedder: Embedder = async (text) => axis(/crypto|bitcoin/i.test(text) ? 1 : 0)
