// Loads Roma's knowledge base documents (supabase/knowledge/*.md) into a Supabase project
// (Sprint 10.6b). Run only by the owner; never by Claude or CI.
//
//   KNOWLEDGE_ENV_FILE=~/path/outside/the/repo/dev.env npm run knowledge:ingest
//   npm run knowledge:ingest -- --check      # read and chunk the files only; no key, no network
//
// The env file holds two lines and lives outside the repository:
//   SUPABASE_URL=https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=<the project's service-role key>
// The key is the one the project gives its Edge Functions as SUPABASE_SERVICE_ROLE_KEY (the
// embed function compares the two). It is never printed, logged or written anywhere.
//
// A run: reads and checks every file (one bad file stops the run before any write), compares
// each file's SHA-256 with content_hash, and for each new or changed file embeds its passages
// through the deployed embed function, then writes the document as draft with a placeholder
// hash, replaces its passages, and finally sets its status and real hash. A run that stops part
// way leaves that document unsearchable and redone next time. Documents whose file is gone are
// retired. Approval is the frontmatter's `status: approved`, set by the owner after review.
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PENDING_HASH, chunkText, parseDocument, planIngestion, type ParsedFile, type StoredDocument } from "./knowledge.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCUMENTS_DIR = join(REPO, "supabase", "knowledge");
const EMBED_BATCH = 16;

function readFiles(): ParsedFile[] {
  const names = readdirSync(DOCUMENTS_DIR).filter((name) => name.endsWith(".md") && name !== "README.md").sort();
  return names.map((name) => parseDocument(name, readFileSync(join(DOCUMENTS_DIR, name), "utf8")));
}

function readEnv(): { url: string; key: string } {
  const path = process.env.KNOWLEDGE_ENV_FILE?.replace(/^~(?=\/)/, homedir());
  if (!path) throw new Error("Set KNOWLEDGE_ENV_FILE to the env file outside the repository.");
  const full = resolve(path);
  if (!relative(REPO, full).startsWith("..")) throw new Error("The env file must be outside the repository.");
  const values = new Map<string, string>();
  for (const line of readFileSync(full, "utf8").split(/\r?\n/)) {
    const pair = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (pair) values.set(pair[1]!, pair[2]!.replace(/^["']|["']$/g, ""));
  }
  const url = values.get("SUPABASE_URL") ?? "";
  const key = values.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!/^https:\/\/[^/\s]+$/.test(url.replace(/\/$/, ""))) throw new Error("SUPABASE_URL in the env file must be the project's https URL.");
  if (key.length < 20) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing from the env file.");
  return { url: url.replace(/\/$/, ""), key };
}

class Project {
  private readonly url: string;
  private readonly key: string;

  constructor(env: { url: string; key: string }) {
    this.url = env.url;
    this.key = env.key;
  }

  private async call(path: string, init: { method: string; body?: unknown; prefer?: string }): Promise<unknown> {
    const response = await fetch(`${this.url}${path}`, {
      method: init.method,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    if (!response.ok) {
      // Status and the server's error code and message only; never the request or headers.
      let detail = "";
      try {
        const error = JSON.parse(text) as { code?: string; message?: string; error?: string };
        detail = `${error.code ?? ""} ${error.message ?? error.error ?? ""}`.trim();
      } catch {
        detail = "";
      }
      throw new Error(`${init.method} ${path.split("?")[0]} failed: ${response.status} ${detail}`.slice(0, 300));
    }
    return text ? JSON.parse(text) : null;
  }

  stored(): Promise<StoredDocument[]> {
    return this.call("/rest/v1/knowledge_documents?select=slug,content_hash,status", { method: "GET" }) as Promise<StoredDocument[]>;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const body = (await this.call("/functions/v1/embed", { method: "POST", body: { texts: batch } })) as { embeddings?: number[][] };
      if (!Array.isArray(body?.embeddings) || body.embeddings.length !== batch.length) throw new Error("The embed function returned the wrong number of vectors.");
      vectors.push(...body.embeddings);
    }
    return vectors;
  }

  async write(file: ParsedFile, chunks: string[], vectors: number[][]): Promise<void> {
    const { document } = file;
    // 1. The document as draft with the placeholder hash: unsearchable while its passages change.
    const rows = (await this.call("/rest/v1/knowledge_documents?on_conflict=slug&select=id,status,approved_at", {
      method: "POST",
      body: { ...document, status: "draft", approved_at: null, content_hash: PENDING_HASH },
      prefer: "resolution=merge-duplicates,return=representation",
    })) as { id: string }[];
    const id = rows[0]?.id;
    if (!id) throw new Error(`No id came back for ${document.slug}.`);
    // 2. Its passages, replaced as a set (one insert statement).
    await this.call(`/rest/v1/knowledge_chunks?document_id=eq.${id}`, { method: "DELETE" });
    await this.call("/rest/v1/knowledge_chunks", {
      method: "POST",
      body: chunks.map((content, i) => ({ document_id: id, seq: i + 1, content, embedding: JSON.stringify(vectors[i]) })),
      prefer: "return=minimal",
    });
    // 3. Its real status and hash.
    await this.call(`/rest/v1/knowledge_documents?id=eq.${id}`, {
      method: "PATCH",
      body: {
        status: document.status,
        approved_at: document.status === "approved" ? new Date().toISOString() : null,
        content_hash: file.contentHash,
      },
      prefer: "return=minimal",
    });
  }

  async retire(slugs: string[]): Promise<void> {
    if (slugs.length === 0) return;
    await this.call(`/rest/v1/knowledge_documents?slug=in.(${slugs.join(",")})`, {
      method: "PATCH",
      body: { status: "retired" },
      prefer: "return=minimal",
    });
  }
}

async function main() {
  const files = readFiles();
  const chunksBySlug = new Map(files.map((file) => [file.document.slug, chunkText(file.body)]));
  if (process.argv.includes("--check")) {
    for (const file of files) console.warn(`${file.document.slug}: ${file.document.content_kind}, ${file.document.status}, ${chunksBySlug.get(file.document.slug)!.length} passages`);
    console.warn(`${files.length} documents read; nothing written.`);
    return;
  }

  const project = new Project(readEnv());
  const plan = planIngestion(files, await project.stored());
  for (const slug of plan.write) {
    const file = files.find((f) => f.document.slug === slug)!;
    const chunks = chunksBySlug.get(slug)!;
    await project.write(file, chunks, await project.embed(chunks));
    console.warn(`${slug}: written (${file.document.status}, ${chunks.length} passages)`);
  }
  await project.retire(plan.retire);
  console.warn(`${plan.write.length} written, ${plan.unchanged.length} unchanged, ${plan.retire.length} retired.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Ingestion failed.");
  process.exitCode = 1;
});
