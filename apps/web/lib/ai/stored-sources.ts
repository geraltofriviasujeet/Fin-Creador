import { isPastFinancialYear } from "@fin-creador/domain"
import { z } from "zod"
import type { Citation } from "./knowledge/citations"
import type { GoalCheck, TaxBlock } from "./tools/types"

// A turn's citations and tax card, kept on it (10.6d, 20261114180000_roma_turn_sources.sql) so
// a reopened conversation shows them. Checked with these schemas, which mirror the database's
// checks, before writing and again before showing; a value that fails is left out, never the
// turn. "Out of date" is not stored: it is worked out from the year when the turn is shown.
// Citations are trimmed in code to fit the column, so a turn never fails to save on size.
// From 10.7a a goal check's, trip check's or what-if's card is kept the same way
// (20261115120000_roma_turn_card.sql), with its figures table: one card per turn, so a turn with
// several checks keeps its text only.

/** ai_messages_citations_size is 32768 bytes of jsonb text; room is kept for the spaces it adds. */
export const CITATIONS_MAX_BYTES = 32768 - 1024
/** ai_messages_tax_size is 16384 bytes, the same way. */
export const TAX_MAX_BYTES = 16384 - 512
export const MAX_STORED_CITATIONS = 12
export const MAX_STORED_PASSAGES = 4
/** A passage is never cut shorter than this; past it, the citations are not stored. */
const MIN_PASSAGE_CHARS = 80

const year = z.string().regex(/^\d{4}-\d{2}$/)

const storedCitationSchema = z
  .object({
    n: z.number().int().positive(),
    title: z.string(),
    source: z.string(),
    url: z.string().startsWith("https://").optional(),
    linkPending: z.literal(true).optional(),
    financialYear: year.optional(),
    passages: z.array(z.string()).min(1).max(MAX_STORED_PASSAGES),
  })
  .strict()
export const storedCitationsSchema = z.array(storedCitationSchema).min(1).max(MAX_STORED_CITATIONS)
export type StoredCitations = z.infer<typeof storedCitationsSchema>

export const storedTaxSchema = z
  .object({
    taxYear: year,
    regimes: z
      .array(z.object({ title: z.string(), rows: z.array(z.object({ label: z.string(), value: z.string(), total: z.literal(true).optional() }).strict()) }).strict())
      .min(1)
      .max(2),
    comparison: z.string(),
    assumptions: z.array(z.string()),
    sources: z.array(z.string()),
  })
  .strict()
export type StoredTax = z.infer<typeof storedTaxSchema>

export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

/**
 * The citations as stored: at most 12, at most 4 passages each, no out-of-date flag, and within
 * CITATIONS_MAX_BYTES (the longest passage is cut, marked "…", until they fit); null when they
 * can't be stored.
 */
export function toStoredCitations(citations: readonly Citation[]): StoredCitations | null {
  const stored = citations.slice(0, MAX_STORED_CITATIONS).map(({ outOfDate: _, passages, ...c }) => ({ ...c, passages: passages.slice(0, MAX_STORED_PASSAGES) }))
  while (jsonBytes(stored) > CITATIONS_MAX_BYTES) {
    const all = stored.flatMap((c) => c.passages.map((p, i) => ({ c, i, length: p.length })))
    const longest = all.reduce((a, b) => (b.length > a.length ? b : a), all[0]!)
    if (!longest || longest.length <= MIN_PASSAGE_CHARS) return null
    const cut = Math.max(MIN_PASSAGE_CHARS, Math.floor(longest.length * 0.8))
    longest.c.passages[longest.i] = `${longest.c.passages[longest.i]!.slice(0, cut - 1).trimEnd()}…`
  }
  const checked = storedCitationsSchema.safeParse(stored)
  return checked.success ? checked.data : null
}

/** The tax card as stored, without its out-of-date flag; null when it doesn't pass the checks. */
export function toStoredTax({ outOfDate: _, ...tax }: TaxBlock): StoredTax | null {
  const checked = storedTaxSchema.safeParse(tax)
  return checked.success && jsonBytes(checked.data) <= TAX_MAX_BYTES ? checked.data : null
}

/** Stored citations, shown only if they still parse, with the out-of-date notice as of `today`. */
export function shownCitations(raw: unknown, today: string): Citation[] | null {
  const checked = storedCitationsSchema.safeParse(raw)
  if (!checked.success) return null
  return checked.data.map((c) => ({ ...c, ...(c.financialYear && isPastFinancialYear(c.financialYear, today) ? { outOfDate: true as const } : {}) }))
}

/** A stored tax card, the same way. */
export function shownTax(raw: unknown, today: string): TaxBlock | null {
  const checked = storedTaxSchema.safeParse(raw)
  if (!checked.success) return null
  return { ...checked.data, ...(isPastFinancialYear(checked.data.taxYear, today) ? { outOfDate: true as const } : {}) }
}

/** ai_messages_card_size is 16384 bytes, the same way. */
export const CARD_MAX_BYTES = 16384 - 512
export const MAX_STORED_FIGURES = 40

/** A figures-table row as shown: label and value, both formatted in code. */
export type ShownFigure = { label: string; value: string }

export const storedCardSchema = z
  .object({
    kind: z.enum(["goal", "trip", "what_if"]),
    goal: z.string(),
    verdict: z.string(),
    caveat: z.string().optional(),
    assumptions: z.array(z.string()),
    lines: z.array(z.string()).optional(),
    comparison: z
      .object({
        before: z.string(),
        after: z.string(),
        rows: z.array(z.object({ label: z.string(), before: z.string(), after: z.string() }).strict()).min(1).max(6),
      })
      .strict()
      .optional(),
    web: z.object({ verdict: z.string(), summary: z.string(), webOnly: z.literal(true).optional() }).strict().optional(),
    figures: z.array(z.object({ label: z.string(), value: z.string() }).strict()).max(MAX_STORED_FIGURES).optional(),
  })
  .strict()
  .refine((card) => card.comparison === undefined || card.kind === "what_if")
export type StoredCard = z.infer<typeof storedCardSchema>

/** The card as shown with an answer, without its summary or web hook, and the figures table; null for no check, several, or one that fails the checks. */
export function toStoredCard(checks: readonly GoalCheck[], figures: readonly ShownFigure[]): StoredCard | null {
  if (checks.length !== 1) return null
  const { kind, goal, verdict, caveat, assumptions, lines, comparison, web } = checks[0]!
  const card = {
    kind: kind ?? "goal",
    goal,
    verdict,
    ...(caveat ? { caveat } : {}),
    assumptions,
    ...(lines ? { lines } : {}),
    ...(comparison ? { comparison } : {}),
    ...(web ? { web: { verdict: web.verdict, summary: web.summary, ...(web.webOnly ? { webOnly: true as const } : {}) } } : {}),
    ...(figures.length > 0 ? { figures: figures.slice(0, MAX_STORED_FIGURES).map(({ label, value }) => ({ label, value })) } : {}),
  }
  const checked = storedCardSchema.safeParse(card)
  return checked.success && jsonBytes(checked.data) <= CARD_MAX_BYTES ? checked.data : null
}

/** A stored card, shown only if it still parses: the check as the answer showed it, and its figures table. */
export function shownCard(raw: unknown): { check: Omit<GoalCheck, "summary" | "withTarget">; figures: ShownFigure[] } | null {
  const checked = storedCardSchema.safeParse(raw)
  if (!checked.success) return null
  const { kind, figures = [], ...rest } = checked.data
  return { check: { ...(kind === "goal" ? {} : { kind }), ...rest }, figures }
}
