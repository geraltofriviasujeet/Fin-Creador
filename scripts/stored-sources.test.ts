import { describe, expect, it } from "vitest";
import type { Citation } from "../apps/web/lib/ai/knowledge/citations.ts";
import { MAX_KNOWLEDGE_SEARCHES, KNOWLEDGE_COUNT } from "../apps/web/lib/ai/knowledge/session.ts";
import {
  CITATIONS_MAX_BYTES,
  shownCitations,
  shownTax,
  storedCitationsSchema,
  toStoredCitations,
  toStoredTax,
} from "../apps/web/lib/ai/stored-sources.ts";
import type { TaxBlock } from "../apps/web/lib/ai/tools/types.ts";
import { MAX_CHUNK_CHARS } from "./knowledge.ts";

// A turn's citations and tax card as stored (10.6d): the worst case fits ai_messages' 32768-byte
// check (here, beside the chunker it depends on), and a value that can't is trimmed, not failed.

/** Postgres's jsonb text form: ", " and ": " between items, which the size check measures. */
function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${jsonbText(v)}`).join(", ")}}`;
  return JSON.stringify(value);
}
const bytes = (value: unknown) => new TextEncoder().encode(jsonbText(value)).length;

/** The worst case: every search's passages from a different document, each at the chunker's maximum. */
function worstCase(char: string): Citation[] {
  const passages = MAX_KNOWLEDGE_SEARCHES * KNOWLEDGE_COUNT;
  return Array.from({ length: passages }, (_, i) => ({
    n: i + 1,
    title: `Income tax under the default (new) regime, tax year 2026-27, part ${i + 1}`,
    source: "FinCreador explainer, based on Income Tax Department",
    url: "https://www.example.test/a/long/read-more/path/for/the/document",
    financialYear: "2026-27",
    outOfDate: true as const,
    passages: [char.repeat(MAX_CHUNK_CHARS)],
  }));
}

describe("citations stored with the turn", () => {
  it("fits the worst case of 3 searches × 4 passages at the chunker's maximum in 32768 bytes, untrimmed", () => {
    expect(MAX_KNOWLEDGE_SEARCHES * KNOWLEDGE_COUNT).toBe(12);
    const stored = toStoredCitations(worstCase("x"))!;
    expect(stored).toHaveLength(12);
    expect(stored.every((c) => c.passages[0]!.length === MAX_CHUNK_CHARS)).toBe(true);
    expect(bytes(stored)).toBeLessThanOrEqual(32768);
  });

  it("trims passages of three-byte characters (₹, Devanagari) until they fit, never failing on size", () => {
    const raw = worstCase("₹");
    expect(bytes(raw)).toBeGreaterThan(32768);
    const stored = toStoredCitations(raw)!;
    expect(stored).toHaveLength(12);
    expect(bytes(stored)).toBeLessThanOrEqual(32768);
    expect(new TextEncoder().encode(JSON.stringify(stored)).length).toBeLessThanOrEqual(CITATIONS_MAX_BYTES);
    expect(stored.some((c) => c.passages[0]!.endsWith("…"))).toBe(true);
  });

  it("keeps at most 4 passages of a document and drops the out-of-date flag", () => {
    const stored = toStoredCitations([{ n: 1, title: "T", source: "S", financialYear: "2025-26", outOfDate: true, passages: ["a", "b", "c", "d", "e", "f"] }])!;
    expect(stored).toEqual([{ n: 1, title: "T", source: "S", financialYear: "2025-26", passages: ["a", "b", "c", "d"] }]);
  });

  it("stores nothing for citations that don't pass the checks", () => {
    expect(toStoredCitations([])).toBeNull();
    expect(toStoredCitations([{ n: 1, title: "T", source: "S", url: "http://example.test", passages: ["a"] }])).toBeNull();
  });

  it("shows stored citations only if they still parse, with the out-of-date notice as of today", () => {
    const stored = [{ n: 1, title: "T", source: "S", financialYear: "2026-27", linkPending: true, passages: ["a"] }];
    expect(shownCitations(stored, "2027-03-31")).toEqual(stored);
    expect(shownCitations(stored, "2027-04-01")).toEqual([{ ...stored[0], outOfDate: true }]);
    expect(shownCitations([{ ...stored[0], outOfDate: true }], "2026-11-15")).toBeNull();
    expect(shownCitations([{ ...stored[0], passages: [] }], "2026-11-15")).toBeNull();
    expect(shownCitations({}, "2026-11-15")).toBeNull();
    expect(storedCitationsSchema.safeParse(toStoredCitations(worstCase("₹"))).success).toBe(true);
  });
});

describe("the tax card stored with the turn", () => {
  const tax: TaxBlock = {
    taxYear: "2026-27",
    outOfDate: true,
    regimes: [
      { title: "New regime", rows: [{ label: "Total tax", value: "₹84,240", total: true }] },
      { title: "Old regime", rows: [{ label: "Total tax", value: "₹2,30,880", total: true }] },
    ],
    comparison: "The new regime's total is lower by ₹1,46,640.",
    assumptions: ["No deductions given."],
    sources: ["Income tax under the default (new) regime, tax year 2026-27"],
  };

  it("is stored without its out-of-date flag, and shown with it worked out as of today", () => {
    const { outOfDate: _, ...plain } = tax;
    const stored = toStoredTax(tax)!;
    expect(stored).toEqual(plain);
    expect(shownTax(stored, "2026-11-15")).toEqual(plain);
    expect(shownTax(stored, "2027-04-01")).toEqual({ ...plain, outOfDate: true });
  });

  it("stores and shows nothing that doesn't pass the checks", () => {
    expect(toStoredTax({ ...tax, regimes: [] })).toBeNull();
    expect(shownTax({ ...tax, regimes: [...tax.regimes, tax.regimes[0]] }, "2026-11-15")).toBeNull();
    expect(shownTax({}, "2026-11-15")).toBeNull();
  });
});
