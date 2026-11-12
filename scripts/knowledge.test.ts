import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_CHUNK_CHARS, chunkText, parseDocument, planIngestion, sha256, validFinancialYear, type ParsedFile } from "./knowledge.ts";

const OWN = [
  "---",
  "slug: what-is-an-sip",
  "title: What is an SIP?",
  "kind: own",
  "publisher: FinCreador",
  "based_on_publisher: Example Regulator",
  "read_more_url: https://example.org/sip",
  "reuse_terms: Reuse needs written permission, so this is our own explainer.",
  "reuse_terms_url: https://example.org/terms",
  "reuse_terms_checked_on: 2026-11-13",
  "published_on: 2026-11-13",
  "verified_on: 2026-11-13",
  "---",
  "",
  "An SIP invests a fixed amount every month.",
  "",
].join("\n");

const OFFICIAL = [
  "---",
  "slug: example-slabs",
  "title: Example tax slabs",
  "kind: official",
  "publisher: Example Department",
  "source_url: https://example.org/slabs",
  "reuse_terms: May be reproduced free of charge, accurately, with the source acknowledged.",
  "reuse_terms_checked_on: 2026-11-13",
  "verified_on: 2026-11-13",
  "financial_year: 2026-27",
  "status: approved",
  "---",
  "Slab text.",
].join("\n");

const withLine = (text: string, from: string, to: string) => text.replace(from, to);

describe("parseDocument", () => {
  it("reads an own explainer and an official document", () => {
    const own = parseDocument("what-is-an-sip.md", OWN);
    expect(own.document).toMatchObject({ slug: "what-is-an-sip", content_kind: "own", publisher: "FinCreador", source_url: null, status: "draft", financial_year: null });
    expect(own.body).toBe("An SIP invests a fixed amount every month.");
    expect(own.contentHash).toBe(sha256(OWN));

    const official = parseDocument("example-slabs.md", OFFICIAL);
    expect(official.document).toMatchObject({ content_kind: "official", status: "approved", financial_year: "2026-27", based_on_publisher: null, published_on: null });
  });

  it("enforces the attribution rule both ways", () => {
    expect(() => parseDocument("what-is-an-sip.md", withLine(OWN, "publisher: FinCreador", "publisher: Example Regulator"))).toThrow(/publisher is FinCreador/);
    expect(() => parseDocument("what-is-an-sip.md", withLine(OWN, "read_more_url: https://example.org/sip", "source_url: https://example.org/sip"))).toThrow(/no source_url.*needs read_more_url/);
    expect(() => parseDocument("what-is-an-sip.md", withLine(OWN, "based_on_publisher: Example Regulator", "based_on_publisher: FinCreador"))).toThrow(/based_on_publisher/);
    expect(() => parseDocument("example-slabs.md", withLine(OFFICIAL, "publisher: Example Department", "publisher: FinCreador"))).toThrow(/cannot be FinCreador/);
    expect(() => parseDocument("example-slabs.md", withLine(OFFICIAL, "source_url: https://example.org/slabs", "read_more_url: https://example.org/slabs"))).toThrow(/needs source_url.*no based_on_publisher/);
  });

  it("lets an own explainer go without a link only while permission to link is pending", () => {
    const pending = withLine(OWN, "read_more_url: https://example.org/sip", "link_permission_pending: true");
    expect(parseDocument("what-is-an-sip.md", pending).document).toMatchObject({ read_more_url: null, link_permission_pending: true });
    expect(parseDocument("what-is-an-sip.md", OWN).document.link_permission_pending).toBe(false);
    expect(() => parseDocument("what-is-an-sip.md", withLine(OWN, "read_more_url: https://example.org/sip", ""))).toThrow(/or link_permission_pending: true/);
    expect(() => parseDocument("what-is-an-sip.md", withLine(OWN, "verified_on", "link_permission_pending: true\nverified_on"))).toThrow(/needs read_more_url left empty/);
    expect(() => parseDocument("example-slabs.md", withLine(OFFICIAL, "verified_on", "link_permission_pending: true\nverified_on"))).toThrow(/never has a pending link/);
    expect(() => parseDocument("what-is-an-sip.md", withLine(OWN, "verified_on", "link_permission_pending: yes\nverified_on"))).toThrow(/must be true or false/);
  });

  it("names every problem with the file", () => {
    const bad = withLine(withLine(OWN, "verified_on: 2026-11-13", "verified_on: 2026-02-30"), "reuse_terms_url: https://example.org/terms", "reuse_terms_url: http://example.org/terms");
    expect(() => parseDocument("what-is-an-sip.md", bad)).toThrow(/^what-is-an-sip\.md: .*reuse_terms_url must be an https URL.*verified_on must be a date/);
  });

  it("refuses a slug that differs from the file name, unknown or repeated fields, and no text", () => {
    expect(() => parseDocument("other.md", OWN)).toThrow(/match the file name \(other\)/);
    expect(() => parseDocument("what-is-an-sip.md", withLine(OWN, "---\nslug", "---\nauthor: x\nslug"))).toThrow(/unknown field author/);
    expect(() => parseDocument("what-is-an-sip.md", withLine(OWN, "title: What", "title: x\ntitle: What"))).toThrow(/title given twice/);
    expect(() => parseDocument("what-is-an-sip.md", OWN.replace("An SIP invests a fixed amount every month.", ""))).toThrow(/no text/);
    expect(() => parseDocument("what-is-an-sip.md", "An SIP.")).toThrow(/no frontmatter/);
    expect(() => parseDocument("what-is-an-sip.md", withLine(OWN, "verified_on", "status: live\nverified_on"))).toThrow(/status must be/);
  });

  it("refuses a missing reuse record", () => {
    expect(() => parseDocument("what-is-an-sip.md", withLine(OWN, "reuse_terms_checked_on: 2026-11-13", ""))).toThrow(/reuse_terms_checked_on is required/);
  });
});

describe("validFinancialYear", () => {
  it("accepts consecutive years only", () => {
    expect(validFinancialYear("2026-27")).toBe(true);
    expect(validFinancialYear("2099-00")).toBe(true);
    expect(validFinancialYear("2026-28")).toBe(false);
    expect(validFinancialYear("2026-2027")).toBe(false);
  });
});

describe("chunkText", () => {
  it("packs short paragraphs into one passage and keeps headings with what follows", () => {
    expect(chunkText("## Heading\n\nFirst.\n\nSecond.")).toEqual(["## Heading\n\nFirst.\n\nSecond."]);
    const chunks = chunkText(`${"a".repeat(30)}\n\n## Next\n\n${"b".repeat(30)}`, 50);
    expect(chunks).toEqual(["a".repeat(30), `## Next\n\n${"b".repeat(30)}`]);
  });

  it("cuts long paragraphs at sentence ends and long sentences at spaces, never over the limit", () => {
    const sentence = "This sentence is about forty characters. ";
    const long = sentence.repeat(80);
    const chunks = chunkText(`${long}\n\n${"word ".repeat(400)}`);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    expect(chunks[0]!.endsWith(".")).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(`${long}${"word ".repeat(400)}`.replace(/\s+/g, " ").trim());
  });

  it("refuses a document of more than 200 passages", () => {
    expect(() => chunkText(Array(201).fill("x".repeat(1000)).join("\n\n"))).toThrow(/split the document/);
  });
});

describe("planIngestion", () => {
  const file = (slug: string, hash: string) => ({ document: { slug }, contentHash: hash }) as ParsedFile;

  it("writes new and changed files, skips unchanged ones and retires removed ones", () => {
    const plan = planIngestion(
      [file("a", "1"), file("b", "2"), file("c", "3")],
      [
        { slug: "a", content_hash: "1", status: "approved" },
        { slug: "b", content_hash: "0".repeat(64), status: "draft" },
        { slug: "gone", content_hash: "9", status: "approved" },
        { slug: "old", content_hash: "9", status: "retired" },
      ],
    );
    expect(plan).toEqual({ write: ["b", "c"], unchanged: ["a"], retire: ["gone"] });
  });

  it("refuses two files with one slug", () => {
    expect(() => planIngestion([file("a", "1"), file("a", "2")], [])).toThrow(/used twice/);
  });
});

describe("supabase/knowledge", () => {
  const dir = join(import.meta.dirname, "..", "supabase", "knowledge");
  const files = readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md");

  it("every document parses, chunks within the limits and has a unique slug", () => {
    const parsed = files.map((name) => parseDocument(name, readFileSync(join(dir, name), "utf8")));
    for (const file of parsed) {
      const chunks = chunkText(file.body);
      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
    expect(() => planIngestion(parsed, [])).not.toThrow();
  });
});
