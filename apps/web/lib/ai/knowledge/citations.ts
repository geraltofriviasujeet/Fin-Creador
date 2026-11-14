import { isPastFinancialYear } from "@fin-creador/domain"
import { saidNumbers } from "../output"
import type { Route } from "./route"
import type { KnowledgeSession, Passage } from "./session"

// Citations and the code-built lines of a knowledge answer (Sprint 10.6c). The model cites
// passages by id only ("[[k2]]"); code drops an id this question didn't retrieve, numbers the
// rest in order of first use ("[1]") and builds each citation from the retrieved passage:
// title, source label, link, financial year and the passage text itself, so the reader can
// check that a figure is attached to the right thing.

export const NO_MATERIAL = "I don't have vetted material on this, so I won't answer it from general knowledge."
export const NO_MATERIAL_PART = "I don't have vetted material on the general part of your question, so that part isn't answered."
export const KNOWLEDGE_UNAVAILABLE = "I couldn't search my vetted material just now, so I won't answer this from general knowledge. Try again in a moment."
export const KNOWLEDGE_UNAVAILABLE_PART = "I couldn't search my vetted material just now, so the general part of your question isn't answered."
export const NOT_ADVICE = "General information, not personal advice."

export type Citation = {
  n: number
  title: string
  /** "FinCreador explainer, based on RBI" or "From SEBI". */
  source: string
  /** Only a read-more link the publisher allows (none while permission is pending). */
  url?: string
  /** The publisher needs to permit any link and hasn't yet (decisions log, 2026-11-13). */
  linkPending?: true
  /** The financial year the passage's figures are for ("2026-27"). */
  financialYear?: string
  /** That year has ended in the person's own time zone. */
  outOfDate?: true
  passage: string
}

const MARKER = /\s?\[\[\s*([kK]\d{1,2})\s*\]\]/g

export function sourceLabel(p: Pick<Passage, "kind" | "publisher" | "basedOn">): string {
  if (p.kind === "official") return `From ${p.publisher}`
  return p.basedOn ? `FinCreador explainer, based on ${p.basedOn}` : "FinCreador explainer"
}

export function citationOf(p: Passage, n: number, today: string): Citation {
  const url = p.readMoreUrl && !p.linkPending && /^https:\/\/[^\s"'<>]+$/.test(p.readMoreUrl) ? p.readMoreUrl : null
  return {
    n,
    title: p.title,
    source: sourceLabel(p),
    ...(url ? { url } : {}),
    ...(p.linkPending ? { linkPending: true as const } : {}),
    ...(p.financialYear ? { financialYear: p.financialYear } : {}),
    ...(p.financialYear && isPastFinancialYear(p.financialYear, today) ? { outOfDate: true as const } : {}),
    passage: p.content,
  }
}

/** The text with valid markers numbered ("[1]") and unknown ones removed, and the passages cited, in order. */
export function applyCitations(text: string, passages: readonly Passage[]): { text: string; cited: Passage[] } {
  const cited: Passage[] = []
  const out = text.replace(MARKER, (marker, raw: string) => {
    const passage = passages.find((p) => p.id === raw.toLowerCase())
    if (!passage) return ""
    if (!cited.includes(passage)) cited.push(passage)
    return `${marker.startsWith(" ") ? " " : ""}[${cited.indexOf(passage) + 1}]`
  })
  return { text: out, cited }
}

export type KnowledgeAnswer =
  /** The model's text is not shown: this code-built line is. */
  | { replace: string }
  | {
      text: string
      citations: Citation[]
      /** Numbers written in the cited passages: the answer may quote them. */
      numbers: string[]
      /** A code-built line after the answer. */
      tail: string | null
    }

/**
 * What a question's knowledge searches allow the answer to be. A general question (route
 * "knowledge") is answered only from cited passages, else replaced by a line built here. A
 * question that is both keeps its records part; the general part gets a line when nothing was
 * found. Any answer that cites a passage ends with NOT_ADVICE.
 */
export function knowledgeAnswer(raw: string, session: KnowledgeSession | undefined, route: Route, today: string): KnowledgeAnswer {
  const { text, cited } = applyCitations(raw, session?.passages ?? [])
  const plain = { text, citations: [], numbers: [], tail: null }
  if (route === "knowledge") {
    if (session?.allFailed) return { replace: KNOWLEDGE_UNAVAILABLE }
    if (cited.length === 0) return { replace: NO_MATERIAL }
  }
  if (cited.length > 0) {
    return {
      text,
      citations: cited.map((p, i) => citationOf(p, i + 1, today)),
      numbers: cited.flatMap((p) => saidNumbers(p.content)),
      tail: NOT_ADVICE,
    }
  }
  if (!session || session.searches === 0 || session.passages.length > 0) return plain
  return { ...plain, tail: session.allFailed ? KNOWLEDGE_UNAVAILABLE_PART : NO_MATERIAL_PART }
}
