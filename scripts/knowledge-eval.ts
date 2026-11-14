// Roma's knowledge base evaluation (Sprint 10.6c), run by the owner against dev; never by Claude
// or CI (it needs the deployed embed function and ingested passages).
//
//   KNOWLEDGE_ENV_FILE=~/path/outside/the/repo/dev.env npm run knowledge:eval
//   KNOWLEDGE_ENV_FILE=... npm run knowledge:eval -- --include-drafts
//   npm run knowledge:eval -- --check     # the question set and the real chunker only; no network
//   KNOWLEDGE_ENV_FILE=... npm run knowledge:eval -- --model-query   # also with the model's query
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
// and reported apart. From 10.6d each search keeps only the passages the app keeps (within the
// band of the top one), and the loosely worded questions are reported apart from the original
// ones. Off-topic questions count as handled when nothing is found or the no-product-picks rule
// (apps/web/lib/ai/knowledge/picks.ts) catches them, reported apart; pure ones must find nothing.
//
// --model-query (10.6d, run only by the owner): each question also gets the query the real
// model writes for knowledge_search, through the app's own adapter, system prompt and tool
// definition, with knowledge_search the only tool and no records or personal data in the
// request; the query is printed beside its question and searched beside the words as typed,
// merged as the app merges them. It needs, in the env file:
//   ANTHROPIC_API_KEY=<the Anthropic key>
//   LLM_MODEL=claude-haiku-5-5            (optional; the app's default)
// It runs under vitest (scripts/knowledge-eval-model.live.test.ts), which loads the app's code.
// Nothing is written; keys, tokens and passages are never printed.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isProductPick } from "../apps/web/lib/ai/knowledge/picks.ts";
import { projectEnv, readEnvFile } from "./knowledge-env.ts";
import {
  COUNT,
  EVAL_QUESTIONS,
  type EvalQuestion,
  FLOORS,
  type Found,
  type Outcome,
  TAX_ROUTE_QUESTIONS,
  mergeFound,
  offTopic,
  rank,
  score,
  tally,
  withinBand,
} from "./knowledge-eval-set.ts";
import { documentChunks, embedBatches, parseDocument } from "./knowledge.ts";

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
    return [file.document.slug, { status: file.document.status, chunks: documentChunks(file) }] as const;
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
  for (const q of TAX_ROUTE_QUESTIONS) console.warn(`(tax route, checked by npm test)  ${q}`);
  console.warn(`${EVAL_QUESTIONS.length} questions and ${TAX_ROUTE_QUESTIONS.length} tax phrasings; nothing sent.`);
}

/** The query the model writes for a question's knowledge_search, or null when it wrote none (or one that can't be used). */
export type QueryWriter = (question: string) => Promise<string | null>;

type Results = Map<number, Map<number, Found[] | null>>;

function report(label: string, results: Results, viaScript: (q: EvalQuestion) => boolean) {
  console.warn(`\n=== ${label} ===`);
  for (const loose of [false, true]) {
    console.warn(`${loose ? "Loosely worded" : "Original"} questions`);
    console.warn(`Floor  hit@1      hit@4`);
    for (const floor of FLOORS) {
      const outcomes = EVAL_QUESTIONS.flatMap((q, i): Outcome[] => (viaScript(q) || q.expect === null || (q.loose === true) !== loose ? [] : [score(q, results.get(floor)!.get(i)!)]));
      const t = tally(outcomes);
      console.warn(`${floor.toFixed(2)}   ${t.hit1}/${t.scored}`.padEnd(17) + `${t.hit4}/${t.scored}`);
    }
  }
  console.warn(`Off-topic: handled = nothing found or caught by the no-product-picks rule; pure ones must find nothing`);
  console.warn(`Floor  nothing found  caught by no-picks  handled  pure: nothing found`);
  for (const floor of FLOORS) {
    const t = offTopic(EVAL_QUESTIONS.flatMap((q, i) => (q.expect === null ? [{ q, found: results.get(floor)!.get(i) ?? [], pick: isProductPick(q.question) }] : [])));
    console.warn(`${floor.toFixed(2)}   ${t.nothing}/${t.total}`.padEnd(22) + `${t.picks}/${t.total}`.padEnd(20) + `${t.handled}/${t.total}`.padEnd(9) + `${t.pureNothing}/${t.pure}`);
  }
}

export async function runEvaluation({ includeDrafts, queryFor }: { includeDrafts: boolean; queryFor?: QueryWriter }) {
  const values = readEnvFile();
  const { url, key } = projectEnv(values);
  const publishable = values.get("SUPABASE_PUBLISHABLE_KEY") ?? values.get("SUPABASE_ANON_KEY") ?? "";
  const email = values.get("KNOWLEDGE_EVAL_EMAIL") ?? "";
  const password = values.get("KNOWLEDGE_EVAL_PASSWORD") ?? "";
  if (publishable.length < 20 || !email || !password) throw new Error("Set SUPABASE_PUBLISHABLE_KEY, KNOWLEDGE_EVAL_EMAIL and KNOWLEDGE_EVAL_PASSWORD in the env file.");
  const service = { apikey: key, Authorization: `Bearer ${key}` };

  const documents = (await call(`${url}/rest/v1/knowledge_documents?select=slug,status`, { method: "GET", headers: service })) as { slug: string; status: string }[];
  const status = new Map(documents.map((d) => [d.slug, d.status]));

  const embedAll = async (texts: string[]): Promise<number[][]> => {
    const vectors: number[][] = [];
    for (const batch of embedBatches(texts)) {
      const body = (await call(`${url}/functions/v1/embed`, { method: "POST", headers: service, body: { texts: batch } })) as { embeddings?: number[][] };
      if (!Array.isArray(body?.embeddings) || body.embeddings.length !== batch.length) throw new Error("The embed function returned the wrong number of vectors.");
      vectors.push(...body.embeddings);
    }
    return vectors;
  };
  const vectors = await embedAll(EVAL_QUESTIONS.map((q) => q.question));

  // The model's queries, one per question, printed beside it, and their embeddings.
  const queries: (string | null)[] = [];
  const queryVectors: (number[] | null)[] = [];
  if (queryFor) {
    console.warn(`The model's queries:`);
    for (const q of EVAL_QUESTIONS) {
      const query = await queryFor(q.question);
      queries.push(query);
      console.warn(`  "${q.question}"  ->  ${query === null ? "(no query: the words as typed only)" : `"${query}"`}`);
    }
    const written = queries.filter((x): x is string => x !== null);
    const embedded = written.length > 0 ? await embedAll(written) : [];
    let next = 0;
    for (const query of queries) queryVectors.push(query === null ? null : embedded[next++]!);
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

  const viaScript = (q: EvalQuestion) => q.expect !== null && status.get(q.expect) !== "approved";
  const search = async (q: EvalQuestion, vector: number[], floor: number): Promise<Found[] | null> => {
    if (viaScript(q)) return includeDrafts ? rank(vector, ranked, floor) : null;
    const rows = (await call(`${url}/rest/v1/rpc/match_knowledge_chunks`, {
      method: "POST",
      headers: person,
      body: { p_embedding: JSON.stringify(vector), p_count: COUNT, p_min_similarity: floor },
    })) as { chunk_id: string; document_slug: string; similarity: number; content: string }[];
    return rows.map((r) => ({ slug: r.document_slug, similarity: r.similarity, chars: r.content.length, chunk: r.chunk_id }));
  };

  const asTyped: Results = new Map();
  const withQuery: Results = new Map();
  for (const floor of FLOORS) {
    const typed = new Map<number, Found[] | null>();
    const merged = new Map<number, Found[] | null>();
    for (const [i, q] of EVAL_QUESTIONS.entries()) {
      const own = await search(q, vectors[i]!, floor);
      typed.set(i, own === null ? null : withinBand(own));
      if (!queryFor) continue;
      const vector = queryVectors[i];
      const theirs = own === null || !vector ? [] : ((await search(q, vector, floor)) ?? []);
      merged.set(i, own === null ? null : mergeFound([own, theirs]));
    }
    asTyped.set(floor, typed);
    withQuery.set(floor, merged);
  }

  report("As typed (the person's words only)", asTyped, viaScript);
  if (queryFor) report("With the model's query, merged with the words as typed (as the app searches)", withQuery, viaScript);
  console.warn(`\n${TAX_ROUTE_QUESTIONS.length} tax-calculation phrasings: routed to tax_estimate in code, checked by npm test (scripts/knowledge-eval-set.test.ts).`);
  const drafts = EVAL_QUESTIONS.filter(viaScript);
  if (drafts.length > 0 && !includeDrafts) console.warn(`${drafts.length} questions skipped: their document is not approved (--include-drafts ranks them in this script).`);

  // Detail at the lowest floor: where the expected document came, against the top passage, with
  // passage lengths, so long or short passages that hurt the rate show up.
  const detail = (queryFor ? withQuery : asTyped).get(FLOORS[0]!)!;
  console.warn(`\nAt floor ${FLOORS[0]}${queryFor ? ", with the model's query" : ""}: top ${COUNT} as slug (similarity, passage chars)`);
  for (const [i, q] of EVAL_QUESTIONS.entries()) {
    const found = detail.get(i);
    const outcome = q.expect === null ? (found?.length ? "found" : "nothing") : score(q, found ?? null);
    const list = found ? found.map((f) => `${f.slug} (${f.similarity.toFixed(3)}, ${f.chars})`).join("; ") || "nothing" : "skipped";
    const tags = `${q.loose ? " (loose)" : ""}${q.pure ? " (pure off-topic)" : ""}${q.expect === null && isProductPick(q.question) ? " (no-picks rule)" : ""}`;
    console.warn(`[${outcome}]${tags} ${q.expect ?? "(nothing)"} <- "${q.question}"${queryFor ? `  query: ${queries[i] === null ? "(none)" : `"${queries[i]}"`}` : ""}\n    ${list}`);
  }
}

function main(): Promise<void> | void {
  if (process.argv.includes("--check")) return check();
  const includeDrafts = process.argv.includes("--include-drafts");
  if (process.argv.includes("--model-query")) {
    // The model's adapter is the app's own code, which vitest loads; the same env file is used.
    const result = spawnSync("npx", ["vitest", "run", "scripts/knowledge-eval-model.live.test.ts"], {
      cwd: REPO,
      stdio: "inherit",
      env: { ...process.env, KNOWLEDGE_EVAL_MODEL_QUERY: "1", ...(includeDrafts ? { KNOWLEDGE_EVAL_INCLUDE_DRAFTS: "1" } : {}) },
    });
    process.exitCode = result.status ?? 1;
    return;
  }
  return runEvaluation({ includeDrafts });
}

// Run as a script (npm run knowledge:eval); imported by the --model-query run, it does nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve(main()).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Evaluation failed.");
    process.exitCode = 1;
  });
}
