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
//     is the legacy service-role key or any of the project's secret keys (sb_secret_...), sent as
//     the bearer token or the apikey header (the platform may replace the bearer on the way).
//     The platform decides whether a key is the service role (platformServiceCheck): never a
//     string comparison with the environment, and never the unverified role claim.
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
  /** Whether the token is a service key of this project (verified by the platform). */
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

/** What kind of key an environment variable holds, for logs: missing, jwt, sb_secret or other. */
export function envKeyKind(value: string | undefined): string {
  if (!value) return "missing";
  if (value.startsWith("sb_secret_")) return "sb_secret";
  return value.split(".").length === 3 ? "jwt" : "other";
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const SERVICE_CACHE_MS = 10 * 60 * 1000;
const SERVICE_CACHE_MAX = 64;

/**
 * Whether a token is a service key of this project, as the platform says: the Auth admin API
 * checks the signature (or the secret key) and the service role, so a forged or foreign token
 * fails there. Only tokens that look like a service key are sent; a person's token never is.
 * Answers are cached per isolate by the token's SHA-256, never the token itself. A network
 * failure is not cached and counts as "not the service role".
 */
export function platformServiceCheck(supabaseUrl: string, fetcher: typeof fetch) {
  const cache = new Map<string, { ok: boolean; at: number }>();
  return async (token: string): Promise<boolean> => {
    const kind = tokenKind(token);
    if (kind !== "jwt:service_role" && kind !== "sb_secret") return false;
    const hash = await sha256Hex(token);
    const hit = cache.get(hash);
    if (hit && Date.now() - hit.at < SERVICE_CACHE_MS) return hit.ok;
    // A secret key goes in apikey only; a legacy JWT key is also the bearer.
    const headers: Record<string, string> = { apikey: token };
    if (kind !== "sb_secret") headers.Authorization = `Bearer ${token}`;
    const response = await fetcher(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users?page=1&per_page=1`, { headers });
    await response.body?.cancel();
    const ok = response.status === 200;
    if (cache.size >= SERVICE_CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(hash, { ok, at: Date.now() });
    return ok;
  };
}

/** Why a body was refused with 400; sent back as {"error": "invalid_request", "reason": ...}. */
export type InvalidReason =
  | "body_not_json"
  | "texts_missing"
  | "too_many_texts"
  | "text_empty_or_not_string"
  | "text_too_long"
  | "request_id_missing";

/**
 * What kind of token this looks like, for refusals and logs: never any part of the token beyond
 * a key prefix or a JWT's role claim (read unverified, for diagnosis only).
 */
export function tokenKind(token: string | null): string {
  if (!token) return "none";
  if (token.startsWith("sb_secret_")) return "sb_secret";
  if (token.startsWith("sb_publishable_")) return "sb_publishable";
  const parts = token.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: unknown };
      const role = typeof payload.role === "string" && /^[a-z_]{1,32}$/.test(payload.role) ? payload.role : "unknown";
      return `jwt:${role}`;
    } catch {
      return "jwt:unreadable";
    }
  }
  return "other";
}

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
  const apikey = request.headers.get("apikey");
  const service =
    (await deps.isService(token).catch(() => false)) || (apikey !== null && (await deps.isService(apikey).catch(() => false)));
  const caller: Caller = service ? "service" : "person";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid("body_not_json");
  }
  // A token that is not a service key is treated as a person's, and a person's call needs its
  // question's request_id: checked first, so a service key the function does not know ends
  // here with a reason that says so, not with the person's one-text limit.
  const requestId = caller === "person" ? readRequestId(body) : null;
  if (caller === "person" && !requestId) {
    const seen = `bearer ${tokenKind(token)}, apikey ${tokenKind(apikey)}`;
    deps.log(`embed refused: not a service key and no request_id (${seen})`);
    return json(400, { error: "invalid_request", reason: "request_id_missing", seen_as_person: seen });
  }
  const checked = checkTexts(body, caller);
  if ("reason" in checked) return invalid(checked.reason);
  const texts = checked.texts;
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
