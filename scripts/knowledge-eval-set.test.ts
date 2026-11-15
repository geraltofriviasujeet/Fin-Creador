import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routeQuestion } from "../apps/web/lib/ai/knowledge/route.ts";
import { isProductPick } from "../apps/web/lib/ai/knowledge/picks.ts";
import { BAND, COUNT, EVAL_QUESTIONS, FLOORS, TAX_ROUTE_QUESTIONS, cosine, mergeFound, offTopic, rank, score, tally, withinBand } from "./knowledge-eval-set.ts";
import { type KnowledgeRow, SIMILARITY_BAND, mergeRows, withinBand as appBand } from "../apps/web/lib/ai/knowledge/session.ts";

const SLUGS = readdirSync(join(__dirname, "..", "supabase", "knowledge"))
  .filter((n) => n.endsWith(".md") && n !== "README.md")
  .map((n) => n.replace(/\.md$/, ""));

describe("the evaluation set", () => {
  it("names only real documents, at least 15 of them, with six questions that should find nothing", () => {
    const expected = EVAL_QUESTIONS.flatMap((q) => (q.expect ? [q.expect] : []));
    expect(expected.length).toBeGreaterThanOrEqual(15);
    for (const slug of expected) expect(SLUGS).toContain(slug);
    expect(EVAL_QUESTIONS.filter((q) => q.expect === null)).toHaveLength(6);
    expect(EVAL_QUESTIONS.filter((q) => q.pure)).toHaveLength(3);
    for (const q of EVAL_QUESTIONS.filter((x) => x.pure)) expect(q.expect).toBeNull();
    expect(new Set(EVAL_QUESTIONS.map((q) => q.question)).size).toBe(EVAL_QUESTIONS.length);
    expect(COUNT).toBe(4);
    expect(BAND).toBe(SIMILARITY_BAND);
    expect(FLOORS).toContain(0.82);
  });

  it("has 20 loosely worded questions, each routed where knowledge_search is offered", () => {
    const loose = EVAL_QUESTIONS.filter((q) => q.loose);
    expect(loose).toHaveLength(20);
    for (const q of loose) expect(["knowledge", "both"], q.question).toContain(routeQuestion(q.question));
  });

  it("routes every tax-calculation phrasing to the tax tool", () => {
    expect(TAX_ROUTE_QUESTIONS).toHaveLength(3);
    for (const q of TAX_ROUTE_QUESTIONS) expect(routeQuestion(q), q).toBe("tax");
  });
});

describe("scoring", () => {
  const f = (slug: string) => ({ slug, similarity: 0.9, chars: 500 });

  it("counts a hit at 1, a hit in the top 4, a miss, a correct nothing and a skip", () => {
    const q = { question: "q", expect: "a" };
    const none = { question: "n", expect: null };
    const outcomes = [score(q, [f("a")]), score(q, [f("b"), f("a")]), score(q, [f("b")]), score(q, []), score(none, []), score(none, [f("a")]), score(q, null)];
    expect(outcomes).toEqual(["hit1", "hit4", "miss", "miss", "none_ok", "none_wrong", "skipped"]);
    expect(tally(outcomes)).toEqual({ hit1: 1, hit4: 2, scored: 4, noneOk: 1, noneScored: 2, skipped: 1 });
  });

  it("ranks by cosine similarity above the floor, at most four", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    const passages = [
      { slug: "far", embedding: [0, 1], chars: 1 },
      { slug: "near", embedding: [1, 0.1], chars: 1 },
      { slug: "mid", embedding: [1, 1], chars: 1 },
    ];
    expect(rank([1, 0], passages, 0.5).map((p) => p.slug)).toEqual(["near", "mid"]);
    expect(rank([1, 0], passages, 0.99)).toHaveLength(1);
  });

  it("merges two searches as the app does, and counts off-topic questions handled by nothing found or the no-picks rule", () => {
    const f = (chunk: string, similarity: number) => ({ slug: chunk, similarity, chars: 1, chunk });
    const lists = [[f("a", 0.84), f("b", 0.9)], [f("a", 0.88), f("c", 0.87), f("d", 0.83)]];
    expect(mergeFound(lists).map((x) => [x.chunk, x.similarity])).toEqual([["b", 0.9], ["a", 0.88], ["c", 0.87]]);
    const rows = (l: typeof lists) => l.map((x) => x.map((y) => ({ chunk_id: y.chunk, similarity: y.similarity }) as KnowledgeRow));
    expect(appBand(mergeRows(rows(lists)).slice(0, COUNT)).map((r) => r.chunk_id)).toEqual(mergeFound(lists).map((x) => x.chunk));

    const off = EVAL_QUESTIONS.filter((q) => q.expect === null).map((q) => ({ q, found: q.pure ? [] : [f("x", 0.83)], pick: isProductPick(q.question) }));
    expect(off.filter((r) => r.pick).map((r) => r.q.question)).toEqual([
      "Should I buy Bitcoin or Ethereum now?",
      "Which stock will double next month?",
      "Which mutual fund scheme should I buy for the best returns this year?",
      "bitcoin abhi kharidu kya?",
      "Which IPO should I buy next week?",
    ]);
    expect(offTopic(off)).toEqual({ nothing: 3, picks: 5, handled: 6, total: 6, pureNothing: 3, pure: 3 });
  });

  it("keeps only the passages within the band of the top one", () => {
    const at = (similarity: number) => ({ slug: String(similarity), similarity, chars: 1 });
    expect(withinBand([at(0.9), at(0.85), at(0.849), at(0.83)]).map((f) => f.similarity)).toEqual([0.9, 0.85]);
    expect(withinBand([])).toEqual([]);
  });
});
