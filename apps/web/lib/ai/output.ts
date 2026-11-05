import { z } from "zod"
import { currencyMinorDigits, minorUnitsToDecimalString } from "@fin-creador/domain"
import type { Figure } from "./tools/types"

// Roma's output guard (Sprint 10). An answer is shown only when:
//   * it passes the Zod envelope (non-empty text of bounded length);
//   * every number in it matches a figure from this request's tool results, a count, or a
//     date part of the periods and of today. One unmatched number and the whole answer is
//     refused: numbers are never stripped, rounded or corrected;
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
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => normalizeNumber(m[0].replace(/,+$/, "")))
}

/** The numbers an answer may contain: figure amounts and counts, and date parts. */
export function allowedNumbers(figures: readonly Figure[], dates: readonly string[]): Set<string> {
  const allowed = new Set<string>()
  for (const f of figures) {
    if (f.kind === "count") allowed.add(String(f.value))
    else allowed.add(normalizeNumber(minorUnitsToDecimalString(Math.abs(f.minor), currencyMinorDigits(f.currency))))
  }
  for (const d of dates) for (const part of d.split("-")) allowed.add(normalizeNumber(part))
  return allowed
}

const PRAISE_OPENER =
  /^\s*(?:(?:great|good|excellent|fantastic|wonderful|nice|awesome)\s+(?:question|news|job|work|point)\b|(?:happy to help|i'?d be happy|absolutely|certainly|sure thing)\b)/i

export function checkAnswer(raw: string, allowed: Set<string>): AnswerCheck {
  const parsed = romaAnswerSchema.safeParse({ text: raw })
  if (!parsed.success) return { ok: false, reason: "invalid" }
  const { text } = parsed.data
  if (PRAISE_OPENER.test(text)) return { ok: false, reason: "tone" }
  const unmatched = [...new Set(numbersIn(text).filter((n) => !allowed.has(n)))]
  if (unmatched.length > 0) return { ok: false, reason: "unverified", unmatched }
  return { ok: true, text }
}
