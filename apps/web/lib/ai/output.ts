import { z } from "zod"
import { currencyMinorDigits, formatPercentFromBasisPoints, minorUnitsToDecimalString } from "@fin-creador/domain"
import type { Figure } from "./tools/types"

// Roma's output guard (Sprint 10). An answer is shown only when:
//   * it passes the Zod envelope (non-empty text of bounded length);
//   * every money-shaped number and every percentage in it matches a figure from this
//     request's tool results or a date part of the periods and of today. A number is
//     money-shaped when it carries a currency marker (₹, Rs, INR, "rupees"), a decimal part,
//     thousands separators or a scale word (lakh, crore, L, Cr, K), or is 1000 or more. Other
//     numbers (small bare integers: counts, nights, travellers, list markers) and dates
//     (2026-11-07, "December 2027") pass (10.8). One unmatched figure and the whole answer is
//     refused: numbers are never stripped, rounded or corrected. Digits inside a string a tool
//     returned (a goal, category or account name such as "Car 2027") are not figures: those
//     strings are set aside, exactly as written (any case), before the numbers are read;
//   * it doesn't open with praise (Roma's rules).

export const MAX_ANSWER_CHARS = 2000

export const romaAnswerSchema = z.object({ text: z.string().trim().min(1).max(MAX_ANSWER_CHARS) })

export type AnswerCheck = { ok: true; text: string } | { ok: false; reason: "invalid" | "unverified" | "tone"; unmatched?: string[] }

/** A number as a plain decimal: no grouping, no leading zeros, no trailing fractional zeros. */
export function normalizeNumber(raw: string): string {
  const [whole = "", fraction = ""] = raw.replace(/,/g, "").split(".")
  const w = whole.replace(/^0+(?=\d)/, "")
  const f = fraction.replace(/0+$/, "")
  return f ? `${w}.${f}` : w
}

/** Every number written in the text (digits with optional grouping and decimals), normalized. */
export function numbersIn(text: string): string[] {
  return numbersWritten(text).map((n) => n.value)
}

/** Dates are not figures: ISO dates and a year after a month name. */
const DATES = /\b\d{4}-\d{2}(?:-\d{2})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4}\b/gi
/** A currency sign or code just before a number: money. */
const MONEY_BEFORE = /(?:[₹$€£¥]|\b(?:rs|inr|usd|eur|gbp|aed|sgd|thb|vnd)\.?)\s*$/i
/** A currency code or word, or a scale word, just after a number: money. "L" only as a capital. */
const MONEY_AFTER = /^\s*(?:inr|usd|eur|gbp|aed|sgd|thb|vnd|rupees?|dollars?|euros?|pounds?|lakhs?|crores?|cr|k)\b/i
const LAKH_L = /^\s*L\b/
const PERCENT_AFTER = /^\s*(?:%|percent\b|per cent\b)/i

/** Every number written in the text, normalized, and whether it must match a tool figure (money-shaped or a percentage). */
function numbersWritten(text: string): { value: string; checked: boolean }[] {
  const rest = text.replace(DATES, " ")
  return [...rest.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => {
    const raw = m[0].replace(/,+$/, "")
    const value = normalizeNumber(raw)
    const end = m.index + raw.length
    const after = rest.slice(end, end + 10)
    const checked =
      MONEY_BEFORE.test(rest.slice(Math.max(0, m.index - 6), m.index)) ||
      raw.includes(".") ||
      raw.includes(",") ||
      MONEY_AFTER.test(after) ||
      LAKH_L.test(after) ||
      PERCENT_AFTER.test(after) ||
      Number(value) >= 1000
    return { value, checked }
  })
}

/** The numbers an answer may contain: figure amounts, counts and rates (as the tool wrote them), and date parts. */
export function allowedNumbers(figures: readonly Figure[], dates: readonly string[]): Set<string> {
  const allowed = new Set<string>()
  for (const f of figures) {
    if (f.kind === "count") allowed.add(String(f.value))
    else if (f.kind === "percent") for (const n of numbersIn(formatPercentFromBasisPoints(Math.abs(f.bps)))) allowed.add(n)
    else allowed.add(normalizeNumber(minorUnitsToDecimalString(Math.abs(f.minor), currencyMinorDigits(f.currency))))
  }
  for (const d of dates) for (const part of d.split("-")) allowed.add(normalizeNumber(part))
  return allowed
}

/**
 * Every string in a tool result that has a digit and a letter (names, labels, sentences). A
 * string of only digits and punctuation is a figure and must match as one.
 */
export function literalStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (/\d/.test(value) && /\p{L}/u.test(value)) out.push(value)
  } else if (Array.isArray(value)) {
    for (const v of value) literalStrings(v, out)
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) literalStrings(v, out)
  }
  return out
}

/** The text with every occurrence of the literals (longest first, any case) blanked out. */
function withoutLiterals(text: string, literals: readonly string[]): string {
  let rest = text
  for (const literal of [...new Set(literals)].sort((a, b) => b.length - a.length)) {
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    rest = rest.replace(new RegExp(escaped, "gi"), " ")
  }
  return rest
}

// The subject check (10.5): a goal or trip answer must be about what the person asked.

/** Words too common in goal names to tell one from another. */
const GENERIC_WORDS = new Set(["a", "an", "the", "my", "our", "to", "for", "of", "and", "in", "new", "trip", "goal", "fund", "plan", "saving", "savings"])

const wordsOf = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/** Whether the person's words name it: any of its own words (all its words when they are all common ones). */
export function isNamedIn(name: string, said: string): boolean {
  const have = new Set(wordsOf(said))
  const all = wordsOf(name)
  const own = all.filter((w) => !GENERIC_WORDS.has(w))
  return own.length > 0 ? own.some((w) => have.has(w)) : all.length > 0 && all.every((w) => have.has(w))
}

export type SubjectCheck = { ok: true } | { ok: false; checked: string; goals: string[] }

/**
 * Refuses an answer when a check was about something the person didn't name (a goal put in for
 * the one asked about), or when the answer names one of their goals that no check's own result
 * named. `said`: the person's words in this conversation; `toolText`: the checks' results.
 */
export function checkSubjects(answer: string, said: string, subjects: readonly { checked: string; goals: readonly string[] }[], toolText: string): SubjectCheck {
  const text = answer.toLocaleLowerCase()
  const fromTools = toolText.toLocaleLowerCase()
  for (const s of subjects) {
    const fail = { ok: false as const, checked: s.checked, goals: [...s.goals] }
    if (!isNamedIn(s.checked, said)) return fail
    for (const g of s.goals) {
      const name = g.trim().toLocaleLowerCase()
      if (name && text.includes(name) && !fromTools.includes(name)) return { ...fail, checked: g }
    }
  }
  return { ok: true }
}

const PRAISE_OPENER =
  /^\s*(?:(?:great|good|excellent|fantastic|wonderful|nice|awesome)\s+(?:question|news|job|work|point)\b|(?:happy to help|i'?d be happy|absolutely|certainly|sure thing)\b)/i

export function checkAnswer(raw: string, allowed: Set<string>, literals: readonly string[] = []): AnswerCheck {
  const parsed = romaAnswerSchema.safeParse({ text: raw })
  if (!parsed.success) return { ok: false, reason: "invalid" }
  const { text } = parsed.data
  if (PRAISE_OPENER.test(text)) return { ok: false, reason: "tone" }
  const unmatched = [...new Set(numbersWritten(withoutLiterals(text, literals)).filter((n) => n.checked && !allowed.has(n.value)).map((n) => n.value))]
  if (unmatched.length > 0) return { ok: false, reason: "unverified", unmatched }
  return { ok: true, text }
}
