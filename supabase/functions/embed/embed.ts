// embed: turns text into gte-small embeddings for Roma's knowledge base (Sprint 10.6).
// Runtime-agnostic (no Deno or Node globals): index.ts wires it to the Edge Function and
// Supabase's built-in model.
//
// Rules (docs/sprint-plan.md, Sprint 10, "10.6 knowledge base: scope and handoff"):
//   * Supabase's built-in gte-small only (free, no paid provider): 384 dimensions, mean-pooled
//     and normalised, so cosine similarity matches match_knowledge_chunks.
//   * Signed-in people embed one question at a time (the knowledge_search tool, 10.6c), and
//     only inside their own open Roma question: request_id must be a roma_usage reservation
//     that roma_knowledge_embed accepts (20261113120000), so the kill switch, spend caps and
//     daily limit apply, with at most 3 embeddings per question. Checked with the person's own
//     token, which also proves they are signed in.
//   * The service role (the owner's ingestion script) embeds passages in small batches. Its key
//     is the legacy service-role key or any of the project's secret keys (sb_secret_...).
//   * Anyone else gets 401 or 403. Text is never logged or stored; errors carry no request data.
//     A 400 names the rule the body broke (a fixed reason code), never the text.
//   * Every vector is checked (384 finite numbers) before it is returned.

export const DIMENSIONS = 384;
// A question longer than this is cut by the caller; the model reads about 512 tokens anyway.
export const MAX_QUESTION_CHARS = 2000;
// The chunk limit in knowledge_chunks (20261111120000_knowledge_base.sql).
export const MAX_PASSAGE_CHARS = 1200;
export const MAX_BATCH = 16;

export type Caller = "person" | "service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Deps {
  /** Whether the bearer token is the service-role key. */
  isService(token: string): Promise<boolean>;
  /** roma_knowledge_embed under the person's token: true when this embedding is allowed. */
  allowQuestion(token: string, requestId: string): Promise<boolean>;
  /** One gte-small embedding (mean-pooled, normalised). */
  embed(text: string): Promise<number[]>;
  log(line: string): void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const invalid = (reason: InvalidReason) => json(400, { error: "invalid_request", reason });

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

/**
 * The keys that make a caller the service role: the legacy service-role key and every value of
 * the secret keys dictionary (SUPABASE_SECRET_KEYS, JSON such as {"default": "sb_secret_..."}).
 */
export function serviceKeys(legacy: string | undefined, secretKeysJson: string | undefined): string[] {
  const keys = legacy ? [legacy] : [];
  try {
    const parsed: unknown = secretKeysJson ? JSON.parse(secretKeysJson) : null;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      for (const value of Object.values(parsed)) if (typeof value === "string" && value !== "") keys.push(value);
    }
  } catch {
    // Not JSON: only the legacy key counts.
  }
  return keys;
}

/** Whether the token is one of the service keys (each compared in constant time). */
export async function isServiceKey(token: string, keys: string[]): Promise<boolean> {
  const matches = await Promise.all(keys.map((key) => sameKey(token, key)));
  return matches.includes(true);
}

/** Why a body was refused with 400; sent back as {"error": "invalid_request", "reason": ...}. */
export type InvalidReason =
  | "body_not_json"
  | "texts_missing"
  | "too_many_texts"
  | "text_empty_or_not_string"
  | "text_too_long"
  | "request_id_missing";

/** The person's question id (a roma_usage reservation), or null. */
export function readRequestId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const id = (body as { request_id?: unknown }).request_id;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

/** The texts to embed, or the rule the body breaks for this caller. */
export function checkTexts(body: unknown, caller: Caller): { texts: string[] } | { reason: InvalidReason } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { reason: "texts_missing" };
  const texts = (body as { texts?: unknown }).texts;
  if (!Array.isArray(texts) || texts.length === 0) return { reason: "texts_missing" };
  const maxCount = caller === "person" ? 1 : MAX_BATCH;
  const maxChars = caller === "person" ? MAX_QUESTION_CHARS : MAX_PASSAGE_CHARS;
  if (texts.length > maxCount) return { reason: "too_many_texts" };
  for (const text of texts) {
    if (typeof text !== "string" || text.trim() === "") return { reason: "text_empty_or_not_string" };
    if (text.length > maxChars) return { reason: "text_too_long" };
  }
  return { texts: texts as string[] };
}

/** The texts to embed, or null when the body breaks the caller's limits. */
export function readTexts(body: unknown, caller: Caller): string[] | null {
  const checked = checkTexts(body, caller);
  return "texts" in checked ? checked.texts : null;
}

export function validVector(vector: unknown): vector is number[] {
  return Array.isArray(vector) && vector.length === DIMENSIONS && vector.every((v) => typeof v === "number" && Number.isFinite(v));
}

/**
 * POST with a bearer token: {"texts": ["question"], "request_id": "<uuid>"} from a person, or
 * {"texts": [...passages]} from the service role. Answers {"embeddings": [[...384 numbers], ...]}.
 */
export async function handleRequest(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const token = bearer(request.headers.get("Authorization"));
  if (!token) return json(401, { error: "unauthorized" });
  const caller: Caller = (await deps.isService(token).catch(() => false)) ? "service" : "person";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid("body_not_json");
  }
  const checked = checkTexts(body, caller);
  if ("reason" in checked) return invalid(checked.reason);
  const texts = checked.texts;
  // A token that is not a service key is treated as a person's, and a person's call needs its
  // question's request_id: a service key the function does not know ends here.
  const requestId = caller === "person" ? readRequestId(body) : null;
  if (caller === "person" && !requestId) return invalid("request_id_missing");
  // Counted before the model runs; a failed embedding still used one of the question's three.
  if (caller === "person" && !(await deps.allowQuestion(token, requestId!).catch(() => false))) {
    return json(403, { error: "not_allowed" });
  }

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
