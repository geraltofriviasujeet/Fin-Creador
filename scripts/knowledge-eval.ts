// Roma's knowledge base evaluation (Sprint 10.6c), run by the owner against dev; never by Claude
// or CI (it needs the deployed embed function and ingested passages).
//
//   KNOWLEDGE_ENV_FILE=~/path/outside/the/repo/dev.env npm run knowledge:eval
//   KNOWLEDGE_ENV_FILE=... npm run knowledge:eval -- --include-drafts
//   npm run knowledge:eval -- --check     # the question set and the real chunker only; no network
//
// The env file (outside the repository) holds, besides the ingestion script's two lines:
//   SUPABASE_PUBLISHABLE_KEY=<the project's publishable (or legacy anon) key>
//   KNOWLEDGE_EVAL_EMAIL=<a signed-in test user's email: not a real person's account>
//   KNOWLEDGE_EVAL_PASSWORD=<that test user's password>
//
// The real path: the questions are embedded by the deployed embed function (the service key, as
// the ingestion script does), then match_knowledge_chunks is called as the signed-in test user
// at each floor, with the app's count of 4. The service role can't call it (execute is granted to
// authenticated only and it refuses a caller with no auth.uid()), hence the test user; no
// migration. Only with --include-drafts, questions whose document is still a draft are ranked
// in this script instead (cosine over approved and draft passages read with the service key),
// and reported apart. Nothing is written; keys, tokens and passages are never printed.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectEnv, readEnvFile } from "./knowledge-env.ts";
import { COUNT, EVAL_QUESTIONS, FLOORS, type Found, type Outcome, rank, score, tally } from "./knowledge-eval-set.ts";
import { chunkText, embedBatches, parseDocument } from "./knowledge.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCUMENTS_DIR = join(REPO, "supabase", "knowledge");

async function call(url: string, init: { method: string; headers: Record<string, string>; body?: unknown }): Promise<unknown> {
  const response = await fetch(url, {
    method: init.method,
    headers: { "Content-Type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = "";
    try {
      const error = JSON.parse(text) as { code?: string; message?: string; error?: string; error_description?: string; reason?: string };
      detail = `${error.code ?? ""} ${error.message ?? error.error_description ?? error.error ?? ""}${error.reason ? ` (${error.reason})` : ""}`.trim();
    } catch {
      detail = "";
    }
    throw new Error(`${init.method} ${new URL(url).pathname} failed: ${response.status} ${detail}`.slice(0, 400));
  }
  return text ? JSON.parse(text) : null;
}

const parseVector = (v: unknown): number[] => (typeof v === "string" ? (JSON.parse(v) as number[]) : (v as number[]));

function check() {
  const names = readdirSync(DOCUMENTS_DIR).filter((n) => n.endsWith(".md") && n !== "README.md");
  const files = new Map(names.map((n) => {
    const file = parseDocument(n, readFileSync(join(DOCUMENTS_DIR, n), "utf8"));
    return [file.document.slug, { status: file.document.status, chunks: chunkText(file.body) }] as const;
  }));
  for (const q of EVAL_QUESTIONS) {
    if (!q.expect) {
      console.warn(`(nothing)  ${q.question}`);
      continue;
    }
    const doc = files.get(q.expect);
    if (!doc) throw new Error(`${q.expect}: no such document`);
    const lengths = doc.chunks.map((c) => c.length).join(", ");
    console.warn(`${q.expect} (${doc.status}, passages of ${lengths} chars)  ${q.question}`);
  }
  console.warn(`${EVAL_QUESTIONS.length} questions; nothing sent.`);
}

async function main() {
  if (process.argv.includes("--check")) return check();
  const includeDrafts = process.argv.includes("--include-drafts");
  const values = readEnvFile();
  const { url, key } = projectEnv(values);
  const publishable = values.get("SUPABASE_PUBLISHABLE_KEY") ?? values.get("SUPABASE_ANON_KEY") ?? "";
  const email = values.get("KNOWLEDGE_EVAL_EMAIL") ?? "";
  const password = values.get("KNOWLEDGE_EVAL_PASSWORD") ?? "";
  if (publishable.length < 20 || !email || !password) throw new Error("Set SUPABASE_PUBLISHABLE_KEY, KNOWLEDGE_EVAL_EMAIL and KNOWLEDGE_EVAL_PASSWORD in the env file.");
  const service = { apikey: key, Authorization: `Bearer ${key}` };

  const documents = (await call(`${url}/rest/v1/knowledge_documents?select=slug,status`, { method: "GET", headers: service })) as { slug: string; status: string }[];
  const status = new Map(documents.map((d) => [d.slug, d.status]));

  const vectors: number[][] = [];
  for (const batch of embedBatches(EVAL_QUESTIONS.map((q) => q.question))) {
    const body = (await call(`${url}/functions/v1/embed`, { method: "POST", headers: service, body: { texts: batch } })) as { embeddings?: number[][] };
    if (!Array.isArray(body?.embeddings) || body.embeddings.length !== batch.length) throw new Error("The embed function returned the wrong number of vectors.");
    vectors.push(...body.embeddings);
  }

  const session = (await call(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: publishable }, body: { email, password } })) as { access_token?: string };
  if (!session?.access_token) throw new Error("The test user couldn't sign in.");
  const person = { apikey: publishable, Authorization: `Bearer ${session.access_token}` };

  // Draft passages, read only for --include-drafts.
  let ranked: { slug: string; embedding: number[]; chars: number }[] = [];
  if (includeDrafts) {
    const rows = (await call(`${url}/rest/v1/knowledge_chunks?select=content,embedding,knowledge_documents!inner(slug,status)&knowledge_documents.status=in.(approved,draft)`, {
      method: "GET",
      headers: service,
    })) as { content: string; embedding: unknown; knowledge_documents: { slug: string } }[];
    ranked = rows.map((r) => ({ slug: r.knowledge_documents.slug, embedding: parseVector(r.embedding), chars: r.content.length }));
  }

  const viaScript = (expect: string | null) => expect !== null && status.get(expect) !== "approved";
  const results = new Map<number, Map<number, Found[] | null>>();
  for (const floor of FLOORS) {
    const byQuestion = new Map<number, Found[] | null>();
    for (const [i, q] of EVAL_QUESTIONS.entries()) {
      if (viaScript(q.expect)) {
        byQuestion.set(i, includeDrafts ? rank(vectors[i]!, ranked, floor) : null);
        continue;
      }
      const rows = (await call(`${url}/rest/v1/rpc/match_knowledge_chunks`, {
        method: "POST",
        headers: person,
        body: { p_embedding: JSON.stringify(vectors[i]), p_count: COUNT, p_min_similarity: floor },
      })) as { document_slug: string; similarity: number; content: string }[];
      byQuestion.set(i, rows.map((r) => ({ slug: r.document_slug, similarity: r.similarity, chars: r.content.length })));
    }
    results.set(floor, byQuestion);
  }

  console.warn(`Floor  hit@1      hit@4      nothing found correctly  (approved, through match_knowledge_chunks)`);
  for (const floor of FLOORS) {
    const outcomes = EVAL_QUESTIONS.flatMap((q, i): Outcome[] => (viaScript(q.expect) ? [] : [score(q, results.get(floor)!.get(i)!)]));
    const t = tally(outcomes);
    console.warn(`${floor.toFixed(2)}   ${t.hit1}/${t.scored}`.padEnd(17) + `${t.hit4}/${t.scored}`.padEnd(11) + `${t.noneOk}/${t.noneScored}`);
  }
  const drafts = EVAL_QUESTIONS.filter((q) => viaScript(q.expect));
  if (drafts.length > 0 && !includeDrafts) console.warn(`${drafts.length} questions skipped: their document is not approved (--include-drafts ranks them in this script).`);
  if (includeDrafts && drafts.length > 0) {
    console.warn(`\nNot approved, ranked in this script over approved and draft passages:`);
    for (const floor of FLOORS) {
      const t = tally(EVAL_QUESTIONS.flatMap((q, i): Outcome[] => (viaScript(q.expect) ? [score(q, results.get(floor)!.get(i)!)] : [])));
      console.warn(`${floor.toFixed(2)}   hit@1 ${t.hit1}/${t.scored}, hit@4 ${t.hit4}/${t.scored}`);
    }
  }

  // Detail at the lowest floor: where the expected document came, against the top passage, with
  // passage lengths, so long passages that hurt the rate show up.
  const lowest = results.get(FLOORS[0]!)!;
  console.warn(`\nAt floor ${FLOORS[0]}: top ${COUNT} as slug (similarity, passage chars)`);
  for (const [i, q] of EVAL_QUESTIONS.entries()) {
    const found = lowest.get(i);
    const outcome = score(q, found ?? null);
    const list = found ? found.map((f) => `${f.slug} (${f.similarity.toFixed(3)}, ${f.chars})`).join("; ") || "nothing" : "skipped";
    console.warn(`[${outcome}] ${q.expect ?? "(nothing)"} <- "${q.question}"\n    ${list}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Evaluation failed.");
  process.exitCode = 1;
});
