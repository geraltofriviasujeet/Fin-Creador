import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNT, EVAL_QUESTIONS, FLOORS, cosine, rank, score, tally } from "./knowledge-eval-set.ts";

const SLUGS = readdirSync(join(__dirname, "..", "supabase", "knowledge"))
  .filter((n) => n.endsWith(".md") && n !== "README.md")
  .map((n) => n.replace(/\.md$/, ""));

describe("the evaluation set", () => {
  it("names only real documents, at least 15 of them, with three questions that should find nothing", () => {
    const expected = EVAL_QUESTIONS.flatMap((q) => (q.expect ? [q.expect] : []));
    expect(expected.length).toBeGreaterThanOrEqual(15);
    for (const slug of expected) expect(SLUGS).toContain(slug);
    expect(EVAL_QUESTIONS.filter((q) => q.expect === null)).toHaveLength(3);
    expect(new Set(EVAL_QUESTIONS.map((q) => q.question)).size).toBe(EVAL_QUESTIONS.length);
    expect(COUNT).toBe(4);
    expect(FLOORS).toContain(0.8);
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
});
