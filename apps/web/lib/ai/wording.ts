import { routeQuestion } from "./knowledge/route"

// What Roma sends, in the owner-approved words (Sprint 10). Shown on the Settings toggle and,
// from step 10.2, in Roma the first time a question would send transaction descriptions.
export const ROMA_DATA_NOTICE =
  "Roma sends your question and summaries of your figures to Anthropic to answer it. When you ask her to find transactions, up to 20 matching descriptions (which can include payee names) are sent too. Account numbers are masked. Off by default."

export const ROMA_INFORMATIONAL = "Informational only, not financial advice. Figures come from your own records or the cited source."

/** The retention rule (roma_prune_conversations), shown beside the history list and in Settings. */
export const ROMA_RETENTION = "Conversations are deleted 180 days after the last message."

/** The chips above an answer: what actually ran, never a claim of records no records tool read. */
export function basisLabels(basis: { records: boolean; knowledge: boolean; calculated: boolean }): string[] {
  return [
    ...(basis.records ? ["From your records"] : []),
    ...(basis.calculated ? ["Calculated from the tax rules"] : []),
    ...(basis.knowledge ? ["From the knowledge base"] : []),
  ]
}

/**
 * The line shown while a question is out (10.6d): "checking your records" only when records tools
 * are offered (a plan, or the records or both route; every question when the knowledge base is
 * off, as on the server: handle.ts), otherwise a plain one.
 */
export function progressLine(question: string, { plan, knowledge }: { plan: boolean; knowledge: boolean }): string {
  const route = knowledge ? routeQuestion(question) : "records"
  return plan || route === "records" || route === "both" ? "Roma is checking your records…" : "Roma is working…"
}

/**
 * An answer split at Markdown bold ("**New regime**", 10.6e), for the page to show bold; a stray
 * "**" with no pair is dropped, so none is ever shown as written.
 */
export function boldParts(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/\*\*([^*\n]+?)\*\*/g)
    .map((part, i) => ({ text: i % 2 === 1 ? part : part.replace(/\*\*/g, ""), bold: i % 2 === 1 }))
    .filter((p) => p.text !== "")
}
