// Pure parts of the knowledge base ingestion (Sprint 10.6b): reading a document file, cutting
// it into passages, hashing it and deciding what to write. No file system or network here;
// scripts/ingest-knowledge.ts does that.
//
// A document is a Markdown file in supabase/knowledge/<slug>.md: a frontmatter block of flat
// "key: value" lines between two "---" lines, then the text. The rules mirror the check
// constraints on public.knowledge_documents (20261111120000_knowledge_base.sql), so a file the
// database would refuse is refused here first, with the file and the field named.
import { createHash } from "node:crypto";
import { MAX_BATCH } from "../supabase/functions/embed/embed.ts";

export const MAX_CHUNK_CHARS = 1200;
export const MAX_CHUNKS = 200;
/** A passage shorter than this is merged into a neighbour where the two fit (10.6d). */
export const MIN_CHUNK_CHARS = 300;
/**
 * Part of every document's hash: raised whenever the passages or the text embedded for them are
 * made differently, so the next ingestion re-embeds every document. 2: short passages merged and
 * the also_known_as line embedded (10.6d).
 */
export const CHUNKING_VERSION = 2;
/** The also_known_as line, at most this long. */
export const MAX_ALIASES_CHARS = 200;
// Passages per call to the embed function: its own cap, so the two cannot drift.
export const EMBED_BATCH = MAX_BATCH;
export const FINCREADOR = "FinCreador";
// A placeholder hash written while a document's passages are replaced, so a run that stops half
// way never matches the file and the next run redoes it.
export const PENDING_HASH = "0".repeat(64);

export type Kind = "official" | "own";
export type Status = "draft" | "approved" | "retired";

export interface KnowledgeDocument {
  slug: string;
  title: string;
  content_kind: Kind;
  publisher: string;
  source_url: string | null;
  based_on_publisher: string | null;
  read_more_url: string | null;
  link_permission_pending: boolean;
  reuse_terms: string;
  reuse_terms_url: string | null;
  reuse_terms_checked_on: string;
  published_on: string | null;
  verified_on: string;
  financial_year: string | null;
  status: Status;
}

export interface ParsedFile {
  document: KnowledgeDocument;
  body: string;
  /** Other names for the document's subject (also_known_as): embedded with each passage, never shown or stored as its text. */
  aliases: string[];
  contentHash: string;
}

const FIELDS = [
  "slug",
  "title",
  "kind",
  "publisher",
  "source_url",
  "based_on_publisher",
  "read_more_url",
  "link_permission_pending",
  "reuse_terms",
  "reuse_terms_url",
  "reuse_terms_checked_on",
  "published_on",
  "verified_on",
  "financial_year",
  "status",
  "also_known_as",
] as const;
type Field = (typeof FIELDS)[number];

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validUrl(value: string): boolean {
  return value.length <= 500 && /^https:\/\/\S+$/.test(value);
}

/** 'YYYY-YY' with the second year following the first ('2026-27', '2099-00'). */
export function validFinancialYear(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  return Number(value.slice(5)) === (Number(value.slice(0, 4)) + 1) % 100;
}

/** Reads one document file; throws with the file name and every problem found. */
export function parseDocument(fileName: string, text: string): ParsedFile {
  const problems: string[] = [];
  const fail = () => new Error(`${fileName}: ${problems.join("; ")}`);

  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) {
    problems.push("no frontmatter block (--- ... ---) at the start");
    throw fail();
  }
  const values = new Map<Field, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const pair = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!pair) {
      problems.push(`unreadable line "${line.slice(0, 40)}"`);
      continue;
    }
    const key = pair[1] as Field;
    if (!FIELDS.includes(key)) problems.push(`unknown field ${pair[1]}`);
    else if (values.has(key)) problems.push(`${key} given twice`);
    else values.set(key, pair[2]!.trim());
  }

  const optional = (key: Field) => {
    const value = values.get(key);
    return value === undefined || value === "" ? null : value;
  };
  const required = (key: Field) => {
    const value = optional(key);
    if (value === null) problems.push(`${key} is required`);
    return value ?? "";
  };

  const slug = required("slug");
  const expectedSlug = fileName.replace(/^.*[\\/]/, "").replace(/\.md$/, "");
  if (slug && (slug.length > 80 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))) problems.push("slug must be lowercase words joined by hyphens, at most 80 characters");
  else if (slug && slug !== expectedSlug) problems.push(`slug must match the file name (${expectedSlug})`);

  const title = required("title");
  if (title.length > 200) problems.push("title is longer than 200 characters");

  const kind = required("kind");
  if (kind && kind !== "official" && kind !== "own") problems.push("kind must be official or own");

  const publisher = required("publisher");
  if (publisher.length > 100) problems.push("publisher is longer than 100 characters");
  const basedOn = optional("based_on_publisher");
  if (basedOn !== null && basedOn.length > 100) problems.push("based_on_publisher is longer than 100 characters");

  const sourceUrl = optional("source_url");
  const readMoreUrl = optional("read_more_url");
  const reuseTermsUrl = optional("reuse_terms_url");
  for (const [key, value] of [["source_url", sourceUrl], ["read_more_url", readMoreUrl], ["reuse_terms_url", reuseTermsUrl]] as const) {
    if (value !== null && !validUrl(value)) problems.push(`${key} must be an https URL of at most 500 characters`);
  }

  const pendingText = optional("link_permission_pending") ?? "false";
  if (pendingText !== "true" && pendingText !== "false") problems.push("link_permission_pending must be true or false");
  const linkPending = pendingText === "true";

  // The attribution rule (knowledge_documents_attribution, as relaxed in 20261113120000).
  if (kind === "official") {
    if (publisher === FINCREADOR) problems.push(`an official document's publisher cannot be ${FINCREADOR}`);
    if (sourceUrl === null) problems.push("an official document needs source_url");
    if (basedOn !== null || readMoreUrl !== null) problems.push("an official document has no based_on_publisher or read_more_url");
    if (linkPending) problems.push("an official document never has a pending link");
  } else if (kind === "own") {
    if (publisher !== FINCREADOR) problems.push(`an own explainer's publisher is ${FINCREADOR}`);
    if (sourceUrl !== null) problems.push("an own explainer has no source_url");
    if (basedOn === null || basedOn === FINCREADOR) problems.push("an own explainer needs based_on_publisher (the official publisher)");
    // No link only while the publisher's permission to link is pending, and then no link at all.
    if (readMoreUrl === null && !linkPending) problems.push("an own explainer needs read_more_url, or link_permission_pending: true");
    if (readMoreUrl !== null && linkPending) problems.push("link_permission_pending: true needs read_more_url left empty");
  }

  const reuseTerms = required("reuse_terms");
  if (reuseTerms.length > 500) problems.push("reuse_terms is longer than 500 characters");

  const checkedOn = required("reuse_terms_checked_on");
  const verifiedOn = required("verified_on");
  const publishedOn = optional("published_on");
  for (const [key, value] of [["reuse_terms_checked_on", checkedOn], ["verified_on", verifiedOn], ["published_on", publishedOn ?? ""]] as const) {
    if (value && !validDate(value)) problems.push(`${key} must be a date (YYYY-MM-DD)`);
  }

  const financialYear = optional("financial_year");
  if (financialYear !== null && !validFinancialYear(financialYear)) problems.push("financial_year must look like 2026-27");

  const status = optional("status") ?? "draft";
  if (status !== "draft" && status !== "approved" && status !== "retired") problems.push("status must be draft, approved or retired");

  // Comma-separated other names ("80C, section 80C, ELSS"); no commas inside one name.
  const aliasLine = optional("also_known_as");
  const aliases = aliasLine ? aliasLine.split(",").map((a) => a.trim()).filter(Boolean) : [];
  if (aliasLine !== null && aliasLine.length > MAX_ALIASES_CHARS) problems.push(`also_known_as is longer than ${MAX_ALIASES_CHARS} characters`);

  const body = match[2]!.trim();
  if (body === "") problems.push("the document has no text");

  if (problems.length > 0) throw fail();
  return {
    document: {
      slug,
      title,
      content_kind: kind as Kind,
      publisher,
      source_url: sourceUrl,
      based_on_publisher: basedOn,
      read_more_url: readMoreUrl,
      link_permission_pending: linkPending,
      reuse_terms: reuseTerms,
      reuse_terms_url: reuseTermsUrl,
      reuse_terms_checked_on: checkedOn,
      published_on: publishedOn,
      verified_on: verifiedOn,
      financial_year: financialYear,
      status: status as Status,
    },
    body,
    aliases,
    contentHash: sha256(`chunking ${CHUNKING_VERSION}\n${text}`),
  };
}

// Cuts text longer than the limit at the last space before it (or hard, with no space).
function splitHard(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const space = rest.lastIndexOf(" ", limit);
    const cut = space > 0 ? space : limit;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

// A paragraph over the limit is cut at sentence ends, and a sentence over it at a space.
function splitParagraph(paragraph: string, limit: number): string[] {
  if (paragraph.length <= limit) return [paragraph];
  const sentences = paragraph.match(/[^.!?]+(?:[.!?]+["')\]]*\s*|$)/g) ?? [paragraph];
  return pack(sentences.flatMap((s) => splitHard(s, limit)), limit, " ");
}

function pack(parts: string[], limit: number, joiner: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    const joined = current ? `${current}${joiner}${piece}` : piece;
    if (joined.length <= limit) current = joined;
    else {
      if (current) chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * The document's passages, in order: paragraphs packed together up to the limit, a heading kept
 * with the paragraph after it, long paragraphs cut at sentence ends. Every passage is at most
 * MAX_CHUNK_CHARS; more than MAX_CHUNKS passages is an error (split the document).
 */
export function chunkText(body: string, limit = MAX_CHUNK_CHARS): string[] {
  const blocks = body.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean);
  // Join each heading to the next block so a passage never ends on a bare heading.
  const merged: string[] = [];
  let heading = "";
  for (const block of blocks) {
    if (/^#{1,6}\s/.test(block) && !block.includes("\n")) {
      heading = heading ? `${heading}\n${block}` : block;
      continue;
    }
    merged.push(heading ? `${heading}\n\n${block}` : block);
    heading = "";
  }
  if (heading) merged.push(heading);
  const chunks = mergeShort(pack(merged.flatMap((m) => splitParagraph(m, limit)), limit, "\n\n"), limit);
  if (chunks.length > MAX_CHUNKS) throw new Error(`more than ${MAX_CHUNKS} passages; split the document`);
  return chunks;
}

/**
 * Each passage under MIN_CHUNK_CHARS fixed with a neighbour (10.6d), so a short passage doesn't
 * rank high for unrelated short questions: the two joined where they fit within the limit,
 * otherwise re-split at the paragraph boundary nearest the middle that leaves both at least
 * MIN_CHUNK_CHARS (never just after a heading). The neighbour before is tried first.
 */
function mergeShort(chunks: string[], limit: number): string[] {
  const out = [...chunks];
  for (let i = 0; i < out.length; i += 1) {
    if (out[i]!.length >= MIN_CHUNK_CHARS || out.length === 1) continue;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= out.length) continue;
      const [first, second] = j < i ? [out[j]!, out[i]!] : [out[i]!, out[j]!];
      const fixed = rebalance(first, second, limit);
      if (!fixed) continue;
      out.splice(Math.min(i, j), 2, ...fixed);
      break;
    }
  }
  return out;
}

function rebalance(first: string, second: string, limit: number): string[] | null {
  const joined = `${first}\n\n${second}`;
  if (joined.length <= limit) return [joined];
  const units = joined.split("\n\n");
  let best: string[] | null = null;
  for (let k = 1; k < units.length; k += 1) {
    if (/^#{1,6}\s/.test(units[k - 1]!) && !units[k - 1]!.includes("\n")) continue;
    const left = units.slice(0, k).join("\n\n");
    const right = units.slice(k).join("\n\n");
    if (left.length > limit || right.length > limit || left.length < MIN_CHUNK_CHARS || right.length < MIN_CHUNK_CHARS) continue;
    if (!best || Math.abs(left.length - right.length) < Math.abs(best[0]!.length - best[1]!.length)) best = [left, right];
  }
  return best;
}

/** The line put before each passage of a document with aliases, in the text embedded only. */
export function aliasesLine(aliases: readonly string[]): string {
  return aliases.length > 0 ? `Also known as: ${aliases.join(", ")}\n\n` : "";
}

/** A document's passages, cut short enough that each with its aliases line fits the embed function's limit. */
export function documentChunks(file: Pick<ParsedFile, "body" | "aliases">): string[] {
  return chunkText(file.body, MAX_CHUNK_CHARS - aliasesLine(file.aliases).length);
}

/** The text embedded for a passage: the aliases line, then the passage as stored and shown. */
export function embedText(chunk: string, aliases: readonly string[]): string {
  return `${aliasesLine(aliases)}${chunk}`;
}

/** The passages in the groups the ingestion script sends to the embed function, in order. */
export function embedBatches(chunks: string[], size = EMBED_BATCH): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < chunks.length; i += size) batches.push(chunks.slice(i, i + size));
  return batches;
}

export interface StoredDocument {
  slug: string;
  content_hash: string;
  status: Status;
}

export interface Plan {
  /** New or changed files: re-chunked and re-embedded. */
  write: string[];
  /** Unchanged files: left alone. */
  unchanged: string[];
  /** In the database but no longer in the repo: retired (kept, not searchable). */
  retire: string[];
}

/** What a run does, from the files' hashes and what the database holds. */
export function planIngestion(files: ParsedFile[], stored: StoredDocument[]): Plan {
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.document.slug)) throw new Error(`slug ${file.document.slug} used twice`);
    seen.add(file.document.slug);
  }
  const bySlug = new Map(stored.map((row) => [row.slug, row]));
  const write: string[] = [];
  const unchanged: string[] = [];
  for (const file of files) {
    const row = bySlug.get(file.document.slug);
    (row && row.content_hash === file.contentHash ? unchanged : write).push(file.document.slug);
  }
  const retire = stored.filter((row) => !seen.has(row.slug) && row.status !== "retired").map((row) => row.slug);
  return { write, unchanged, retire };
}
