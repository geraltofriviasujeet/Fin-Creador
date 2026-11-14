// Roma's knowledge base evaluation (Sprint 10.6c): questions with the document each should
// find, questions that should find nothing, and the scoring. Pure; scripts/knowledge-eval.ts
// runs it against a project. From 10.6d, loosely worded questions (Hinglish, shorthand) are
// scored apart, and tax-calculation phrasings are checked to route to tax_estimate (by the unit
// tests: routing is code, so nothing is embedded for them).

/**
 * `loose`: a loosely worded question, reported apart from the original set. `pure` (10.6d): an
 * off-topic question (crypto, nothing to do with personal finance) that must find nothing,
 * whatever the no-product-picks rule does.
 */
export type EvalQuestion = { question: string; expect: string | null; loose?: true; pure?: true };

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
  { question: "Should I buy Bitcoin or Ethereum now?", expect: null, pure: true },
  { question: "Which stock will double next month?", expect: null },
  { question: "Which mutual fund scheme should I buy for the best returns this year?", expect: null },
  { question: "sip kya hota hai", expect: "sip-explained", loose: true },
  { question: "min due only pay?", expect: "credit-card-interest-and-minimum-due", loose: true },
  { question: "term vs endowment which is what", expect: "types-of-life-insurance", loose: true },
  { question: "80c limit kitna hai", expect: "tax-deduction-limits-2026-27", loose: true },
  { question: "ltcg on shares?", expect: "capital-gains-tax-basics-2026-27", loose: true },
  { question: "emergency fund kitna rakhna chahiye", expect: "emergency-fund", loose: true },
  { question: "cibil score kaise badhaye", expect: "credit-scores-and-reports", loose: true },
  { question: "direct ya regular plan, fark kya hai?", expect: "direct-and-regular-plans", loose: true },
  { question: "new regime slabs 2026-27?", expect: "income-tax-new-regime-2026-27", loose: true },
  { question: "loan jaldi band karu? prepay worth it?", expect: "prepaying-a-loan", loose: true },
  // 10.6d: ten more, half Hinglish.
  { question: "health insurance mein waiting period kya hota hai", expect: "health-insurance-how-it-works", loose: true },
  { question: "emi kaise calculate hoti hai", expect: "emi-and-loan-interest", loose: true },
  { question: "ppf aur nps mein kya fark hai", expect: "ppf-epf-and-nps", loose: true },
  { question: "inflation se paisa kaise ghatta hai", expect: "inflation-and-real-returns", loose: true },
  { question: "budget kaise banaye mahine ka", expect: "budgeting-basics", loose: true },
  { question: "nav vs expense ratio?", expect: "how-mutual-funds-work", loose: true },
  { question: "compounding means?", expect: "compounding", loose: true },
  { question: "80d limit for parents", expect: "tax-deduction-limits-2026-27", loose: true },
  { question: "old vs new regime which one", expect: "old-or-new-tax-regime-2026-27", loose: true },
  { question: "diversify how?", expect: "diversification", loose: true },
  // 10.6d: three more off-topic, two in Hinglish.
  { question: "bitcoin abhi kharidu kya?", expect: null, pure: true },
  { question: "aaj ka cricket score kya hai", expect: null, pure: true },
  { question: "Which IPO should I buy next week?", expect: null },
];

/** Phrasings that must route to tax_estimate (apps/web/lib/ai/knowledge/route.ts), checked by the unit tests. */
export const TAX_ROUTE_QUESTIONS = [
  "how much tax on 18 lpa?",
  "tax kitna banega 12 lakh salary pe, calculate karo",
  "estimate my income tax for ₹15,00,000 under both regimes",
];

export const FLOORS = [0.7, 0.75, 0.78, 0.8, 0.82, 0.85, 0.88];
/** The app's passages per search (apps/web/lib/ai/knowledge/session.ts KNOWLEDGE_COUNT). */
export const COUNT = 4;
/** The app keeps only passages within this much of the top one (session.ts SIMILARITY_BAND). */
export const BAND = 0.05;

/** `chunk`: the passage's id, when the database gave it (to merge two searches). */
export type Found = { slug: string; similarity: number; chars: number; chunk?: string };

/**
 * Two searches' rows as the app merges them (apps/web/lib/ai/knowledge/session.ts mergeRows):
 * each passage once at its best similarity, closest first, the app's count, then the band.
 */
export function mergeFound(lists: Found[][], count = COUNT): Found[] {
  const best = new Map<string, Found>();
  for (const f of lists.flat()) {
    const key = f.chunk ?? `${f.slug}:${f.chars}`;
    const seen = best.get(key);
    if (!seen || f.similarity > seen.similarity) best.set(key, f);
  }
  return withinBand([...best.values()].sort((a, b) => b.similarity - a.similarity).slice(0, count));
}

export type OffTopic = { nothing: number; picks: number; handled: number; total: number; pureNothing: number; pure: number };

/** Off-topic questions: handled when nothing is found or the no-product-picks rule catches them; pure ones must find nothing. */
export function offTopic(rows: { q: EvalQuestion; found: Found[]; pick: boolean }[]): OffTopic {
  const off = rows.filter((r) => r.q.expect === null);
  const nothing = off.filter((r) => r.found.length === 0);
  const pure = off.filter((r) => r.q.pure);
  return {
    nothing: nothing.length,
    picks: off.filter((r) => r.pick).length,
    handled: off.filter((r) => r.found.length === 0 || r.pick).length,
    total: off.length,
    pureNothing: pure.filter((r) => r.found.length === 0).length,
    pure: pure.length,
  };
}

/** What the app keeps of a search's rows, closest first: those within BAND of the top one. */
export function withinBand(found: Found[]): Found[] {
  const top = found[0]?.similarity ?? 0;
  return found.filter((f) => Math.round((top - f.similarity) * 1e6) <= BAND * 1e6);
}

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
