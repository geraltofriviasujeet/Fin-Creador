// Roma's knowledge base evaluation (Sprint 10.6c): questions with the document each should
// find, questions that should find nothing, and the scoring. Pure; scripts/knowledge-eval.ts
// runs it against a project.

export type EvalQuestion = { question: string; expect: string | null };

/** `expect`: the document slug that should come back; null: nothing should (no vetted material). */
export const EVAL_QUESTIONS: EvalQuestion[] = [
  { question: "How many months of expenses should an emergency fund cover?", expect: "emergency-fund" },
  { question: "What happens if I only pay the minimum due on my credit card?", expect: "credit-card-interest-and-minimum-due" },
  { question: "What affects a credit score?", expect: "credit-scores-and-reports" },
  { question: "What is the difference between a direct plan and a regular plan of a mutual fund?", expect: "direct-and-regular-plans" },
  { question: "How is an EMI calculated, and why is most of the early EMI interest?", expect: "emi-and-loan-interest" },
  { question: "What is a waiting period in health insurance?", expect: "health-insurance-how-it-works" },
  { question: "What are NAV and the expense ratio of a mutual fund?", expect: "how-mutual-funds-work" },
  { question: "What are the old regime income tax slabs for 2026-27?", expect: "income-tax-old-regime-2026-27" },
  { question: "What is the difference between PPF and NPS?", expect: "ppf-epf-and-nps" },
  { question: "How is a term plan different from an endowment plan?", expect: "types-of-life-insurance" },
  { question: "How does a SIP work?", expect: "sip-explained" },
  { question: "What are the new regime income tax slabs for 2026-27?", expect: "income-tax-new-regime-2026-27" },
  { question: "Should I choose the old or the new tax regime?", expect: "old-or-new-tax-regime-2026-27" },
  { question: "How much can I deduct for health insurance premiums?", expect: "tax-deduction-limits-2026-27" },
  { question: "How are long-term capital gains on equity shares taxed?", expect: "capital-gains-tax-basics-2026-27" },
  { question: "Should I buy Bitcoin or Ethereum now?", expect: null },
  { question: "Which stock will double next month?", expect: null },
  { question: "Which mutual fund scheme should I buy for the best returns this year?", expect: null },
];

export const FLOORS = [0.7, 0.75, 0.78, 0.8, 0.82, 0.85, 0.88];
/** The app's passages per search (apps/web/lib/ai/knowledge/session.ts KNOWLEDGE_COUNT). */
export const COUNT = 4;

export type Found = { slug: string; similarity: number; chars: number };

export type Outcome = "hit1" | "hit4" | "miss" | "none_ok" | "none_wrong" | "skipped";

/** One question's outcome from what came back. A question whose document is not approved is skipped unless it was ranked. */
export function score(q: EvalQuestion, found: Found[] | null): Outcome {
  if (found === null) return "skipped";
  if (q.expect === null) return found.length === 0 ? "none_ok" : "none_wrong";
  if (found[0]?.slug === q.expect) return "hit1";
  return found.some((f) => f.slug === q.expect) ? "hit4" : "miss";
}

export type Tally = { hit1: number; hit4: number; scored: number; noneOk: number; noneScored: number; skipped: number };

export function tally(outcomes: Outcome[]): Tally {
  const count = (o: Outcome) => outcomes.filter((x) => x === o).length;
  const hit1 = count("hit1");
  return {
    hit1,
    hit4: hit1 + count("hit4"),
    scored: hit1 + count("hit4") + count("miss"),
    noneOk: count("none_ok"),
    noneScored: count("none_ok") + count("none_wrong"),
    skipped: count("skipped"),
  };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Script ranking (only for --include-drafts): the closest passages at or above the floor, as match_knowledge_chunks orders them. */
export function rank(question: number[], passages: { slug: string; embedding: number[]; chars: number }[], floor: number, count = COUNT): Found[] {
  return passages
    .map((p) => ({ slug: p.slug, chars: p.chars, similarity: cosine(question, p.embedding) }))
    .filter((p) => p.similarity >= floor)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, count);
}
