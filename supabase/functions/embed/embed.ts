// embed: turns text into gte-small embeddings for Roma's knowledge base (Sprint 10.6).
// Runtime-agnostic (no Deno or Node globals): index.ts wires it to the Edge Function and
// Supabase's built-in model.
//
// Rules (docs/sprint-plan.md, Sprint 10, "10.6 knowledge base: scope and handoff"):
//   * Supabase's built-in gte-small only (free, no paid provider): 384 dimensions, mean-pooled
//     and normalised, so cosine similarity matches match_knowledge_chunks.
//   * Signed-in people embed one question at a time (the knowledge_search tool, 10.6c).
//   * The service role (the owner's ingestion script) embeds passages in small batches.
//   * Anyone else gets 401. Text is never logged or stored; errors carry no request data.
//   * Every vector is checked (384 finite numbers) before it is returned.

export const DIMENSIONS = 384;
// A question longer than this is cut by the caller; the model reads about 512 tokens anyway.
export const MAX_QUESTION_CHARS = 2000;
// The chunk limit in knowledge_chunks (20261111120000_knowledge_base.sql).
export const MAX_PASSAGE_CHARS = 1200;
export const MAX_BATCH = 16;

export type Caller = "person" | "service";

export interface Deps {
  /** Who sent the bearer token: a signed-in person, the service role, or nobody known. */
  caller(token: string): Promise<Caller | null>;
  /** One gte-small embedding (mean-pooled, normalised). */
  embed(text: string): Promise<number[]>;
  log(line: string): void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The bearer token from an Authorization header, or null. */
export function bearer(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match ? match[1]! : null;
}

/** Constant-time comparison of a token with the service-role key (both hashed first). */
export async function sameKey(provided: string, expected: string | undefined): Promise<boolean> {
  if (!expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** The texts to embed, or null when the body breaks the caller's limits. */
export function readTexts(body: unknown, caller: Caller): string[] | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const texts = (body as { texts?: unknown }).texts;
  if (!Array.isArray(texts) || texts.length === 0) return null;
  const maxCount = caller === "person" ? 1 : MAX_BATCH;
  const maxChars = caller === "person" ? MAX_QUESTION_CHARS : MAX_PASSAGE_CHARS;
  if (texts.length > maxCount) return null;
  for (const text of texts) {
    if (typeof text !== "string" || text.trim() === "" || text.length > maxChars) return null;
  }
  return texts as string[];
}

export function validVector(vector: unknown): vector is number[] {
  return Array.isArray(vector) && vector.length === DIMENSIONS && vector.every((v) => typeof v === "number" && Number.isFinite(v));
}

/** POST {"texts": [...]} with a bearer token; answers {"embeddings": [[...384 numbers], ...]}. */
export async function handleRequest(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const token = bearer(request.headers.get("Authorization"));
  const caller = token ? await deps.caller(token).catch(() => null) : null;
  if (!caller) return json(401, { error: "unauthorized" });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid_request" });
  }
  const texts = readTexts(body, caller);
  if (!texts) return json(400, { error: "invalid_request" });

  try {
    const embeddings: number[][] = [];
    for (const text of texts) {
      const vector = await deps.embed(text);
      if (!validVector(vector)) throw new Error("bad vector");
      embeddings.push(vector);
    }
    return json(200, { embeddings });
  } catch (error) {
    // Only the kind of failure: never the text or the token.
    deps.log(`embed failed for ${caller}: ${error instanceof Error ? error.name : "unknown"}`);
    return json(500, { error: "embedding_failed" });
  }
}
