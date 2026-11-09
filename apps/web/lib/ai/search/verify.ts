import { z } from "zod"
import { normalizeNumber } from "../output"
import { compareDecimals } from "./totals"
import type { SearchResult } from "./types"

// Web figures (Sprint 10.8). Prices are found in the results' text here, in code
// (priceCandidates): amount, currency, scale word, the words around it and the source. The
// model only picks candidates by id and labels them; it never types an amount. Each picked
// figure is still checked as a backstop; one is kept only when, in this question's own results:
//   * its URL is one of the results;
//   * the quote is in that result's text (snippet or page text; spacing and case ignored);
//   * the amount is a number in the quote, written next to the currency's sign or code.
// Anything else is dropped, never corrected. Amounts stay in the currency found: nothing here
// converts, and totals are computed in code from kept figures only. A scale written after the
// number ("₹7.40 Lakh", measured on real results) must be reported as written; the full value
// is worked out here, so "7.40" is never read as rupees.
// Ranges and bounds (10.8 follow-up): "$40 to $60", "₹3,000-₹5,000", "40-60 USD", "₹3-5 lakh"
// and "between $40 and $60" give both ends, each a price of its own, linked as a range (the
// low end must be below the high end, or it isn't one); a single price after "from",
// "starting at" or "as low as" (or before "onwards") is a lower bound, after "up to", "under"
// or "below" an upper one. A range's two ends are quoted together.

/** How a currency is written next to an amount. Codes are ISO 4217. */
export const CURRENCY_MARKS: Readonly<Record<string, readonly string[]>> = {
  INR: ["₹", "rs.", "rs", "inr", "rupees"],
  USD: ["us$", "$", "usd"],
  EUR: ["€", "eur", "euro", "euros"],
  GBP: ["£", "gbp"],
  AED: ["aed", "dirham", "dirhams"],
  THB: ["฿", "thb", "baht"],
  SGD: ["s$", "sgd"],
  JPY: ["¥", "jpy", "yen"],
  AUD: ["a$", "aud"],
  CAD: ["c$", "cad"],
  CHF: ["chf"],
  LKR: ["lkr"],
  NPR: ["npr"],
  MYR: ["myr", "rm"],
  IDR: ["idr", "rp"],
  VND: ["vnd", "₫", "dong"],
  KRW: ["₩", "krw", "won"],
  TRY: ["₺", "try", "lira"],
}

export const WEB_CURRENCIES = Object.keys(CURRENCY_MARKS) as [string, ...string[]]

/** Scale words written after an amount, with the zeros each adds. */
export const SCALES = { none: 0, thousand: 3, lakh: 5, crore: 7, million: 6 } as const
export type Scale = keyof typeof SCALES

const SCALE_WORDS: Readonly<Record<string, Scale>> = {
  k: "thousand",
  thousand: "thousand",
  l: "lakh",
  lakh: "lakh",
  lakhs: "lakh",
  lac: "lakh",
  lacs: "lakh",
  crore: "crore",
  crores: "crore",
  cr: "crore",
  million: "million",
  mn: "million",
}
const SCALE_PATTERN = `(?:\\s?(${Object.keys(SCALE_WORDS).join("|")})(?![a-z]))?`

export const webFigureInput = z
  .object({
    label: z.string().trim().min(1).max(80),
    amount: z.string().trim().regex(/^\d[\d,]*(\.\d+)?$/, "digits only, as written on the page"),
    currency: z.enum(WEB_CURRENCIES),
    scale: z.enum(["none", "thousand", "lakh", "crore", "million"]).default("none").describe("A scale word written after the amount (Lakh, crore, k, million), else none."),
    per: z.enum(["total", "night", "person", "person_night", "day_person"]).describe("What the amount covers, as the page says."),
    source_url: z.string().trim().url().max(500),
    quote: z.string().trim().min(3).max(300).describe("The words on the page that state the amount, copied exactly."),
  })
  .strict()

export type WebFigureInput = z.infer<typeof webFigureInput>

/** `value`: the amount with its scale applied, as a plain decimal, worked out in code. */
export type KeptWebFigure = WebFigureInput & { value: string; site: string; title: string }

export type DropReason = "unknown_id" | "unknown_url" | "quote_not_found" | "amount_not_in_quote"

/** Single spaces, typographic quotes and dashes made plain; case kept. */
export const plain = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()

/** The same, in lower case: what quotes are compared on. */
const flat = (text: string) => plain(text).toLocaleLowerCase("en")

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export type FoundPrice = { currency: string; amount: string; scale: Scale }

/** A price that is only one end of what the page says: "from ₹X" or "up to ₹Y". */
export type Bound = "from" | "up_to"
/** One end of a range, with the other end. */
export type RangeEnd = { side: "low" | "high"; other: FoundPrice }

export type PriceMatch = FoundPrice & { start: number; end: number; range?: RangeEnd; bound?: Bound }

const NUM = "(\\d[\\d,]*(?:\\.\\d+)?)"
/** After a price: the joining word and an unmarked high end ("-60", "to 5 lakh"). */
const RANGE_AFTER = new RegExp(`^\\s?(-|to|and)\\s?${NUM}${SCALE_PATTERN}`, "i")
/** Before a price: an unmarked low end ("40-" in "40-60 USD"). */
const RANGE_BEFORE = new RegExp(`(?<![\\d.,])${NUM}\\s?(?:-|to)\\s?$`, "i")
const JOIN = /^\s?(?:-|to|and)\s?$/i
const FROM_BEFORE = /(?:\bfrom|starting (?:at|from)|starts (?:at|from)|as low as|\bmin(?:imum)?(?: of)?)\s*(?:about|around|approx\.?|roughly)?\s*$/i
const FROM_AFTER = /^\s*onwards?\b/i
const UP_TO_BEFORE = /(?:\bup ?to|\bunder|\bbelow|less than|\bmax(?:imum)?(?: of)?|as much as)\s*$/i

const found = (p: PriceMatch): FoundPrice => ({ currency: p.currency, amount: p.amount, scale: p.scale })
const numberAt = (raw: string) => normalizeNumber(raw.replace(/,+$/, ""))

/** Links two prices as a range when the first is below the second; a low end without a scale takes the high end's. */
function pair(t: string, low: PriceMatch, high: PriceMatch, joined: string): boolean {
  if (/and/i.test(joined) && !/between\s*$/i.test(t.slice(Math.max(0, low.start - 12), low.start))) return false
  const lowScale = low.scale === "none" ? high.scale : low.scale
  if (compareDecimals(scaleUp(low.amount, SCALES[lowScale]), scaleUp(high.amount, SCALES[high.scale])) >= 0) return false
  low.scale = lowScale
  const start = low.start
  const end = high.end
  low.start = high.start = start
  low.end = high.end = end
  low.range = { side: "low", other: found(high) }
  high.range = { side: "high", other: found(low) }
  return true
}

/** The prices with ranges linked (and unmarked ends added) and bounds marked. */
function withRanges(t: string, marked: PriceMatch[]): PriceMatch[] {
  const out = [...marked].sort((a, b) => a.start - b.start)
  const taken = (s: number, e: number) => out.some((o) => s < o.end && o.start < e)
  for (let i = 0; i < out.length; i++) {
    const a = out[i]!
    if (a.range) continue
    const next = out[i + 1]
    if (next && !next.range && next.currency === a.currency && JOIN.test(t.slice(a.end, next.start)) && pair(t, a, next, t.slice(a.end, next.start))) continue
    const after = RANGE_AFTER.exec(t.slice(a.end))
    if (after) {
      const s = a.end + after[0].indexOf(after[2]!, after[1]!.length)
      const scale = after[3] ? SCALE_WORDS[after[3].toLocaleLowerCase("en")]! : a.scale
      const high: PriceMatch = { currency: a.currency, amount: numberAt(after[2]!), scale, start: s, end: a.end + after[0].length }
      if (high.amount !== "0" && !taken(high.start, high.end) && pair(t, a, high, after[1]!)) {
        out.push(high)
        out.sort((x, y) => x.start - y.start)
        continue
      }
    }
    const lookback = Math.max(0, a.start - 24)
    const before = RANGE_BEFORE.exec(t.slice(lookback, a.start))
    if (before) {
      const s = lookback + before.index
      const low: PriceMatch = { currency: a.currency, amount: numberAt(before[1]!), scale: "none", start: s, end: s + before[1]!.length }
      if (low.amount !== "0" && !taken(low.start, low.end) && pair(t, low, a, "-")) out.push(low)
    }
  }
  for (const p of out) {
    if (p.range) continue
    const before = t.slice(Math.max(0, p.start - 24), p.start)
    if (FROM_BEFORE.test(before) || FROM_AFTER.test(t.slice(p.end, p.end + 12))) p.bound = "from"
    else if (UP_TO_BEFORE.test(before)) p.bound = "up_to"
  }
  return out.sort((a, b) => a.start - b.start || (a.range?.side === "high" ? 1 : -1))
}

/** Every amount written next to a currency mark in plain text (any case), with where it is; one per number. */
function priceMatches(t: string): PriceMatch[] {
  const out: PriceMatch[] = []
  const numbersAt = new Set<number>()
  for (const [currency, marks] of Object.entries(CURRENCY_MARKS)) {
    for (const mark of marks) {
      const m = escape(mark)
      // A word mark or a dollar never follows a letter ("rs" in "hours", "$" in "s$"); a sign
      // like ₹ may ("80 km₹2,800" on a tariff card). A word mark must also end there, while a
      // sign may touch the number.
      const word = /^[a-z.]+$/.test(mark)
      const before = word || mark.includes("$") ? `(?<![a-z])${m}` : m
      const after = word ? `${m}(?![a-z])` : m
      const num = "(\\d[\\d,]*(?:\\.\\d+)?)"
      const re = new RegExp(`${before}\\s?${num}${SCALE_PATTERN}|${num}${SCALE_PATTERN}\\s?${after}`, "gi")
      for (const match of t.matchAll(re)) {
        const written = match[1] ?? match[3] ?? ""
        const raw = written.replace(/,+$/, "")
        const scaleWord = (match[2] ?? match[4])?.toLocaleLowerCase("en")
        const amount = normalizeNumber(raw)
        // "rs." and "rs" (or "$" and "us$") can find the same number: the first, longer mark wins.
        const at = match.index + match[0].indexOf(written)
        if (amount === "0" || amount === "" || numbersAt.has(at)) continue
        numbersAt.add(at)
        out.push({ currency, amount, scale: scaleWord ? SCALE_WORDS[scaleWord]! : "none", start: match.index, end: match.index + match[0].length })
      }
    }
  }
  return withRanges(t, out)
}

/** Every price in already-plain text, with where it is, its range and bound (10.9 model shortlists pair them with names). */
export const priceMatchesIn = (t: string): readonly Readonly<PriceMatch>[] => priceMatches(t)

/** Every amount written next to a currency mark in the text, with that currency and any scale word after it. */
export function pricesIn(text: string): FoundPrice[] {
  return priceMatches(plain(text)).map(({ currency, amount, scale }) => ({ currency, amount, scale }))
}

/** A price found in code in one result: the model may pick it by id, never retype it. */
export type PriceCandidate = FoundPrice & {
  value: string
  source_url: string
  site: string
  title: string
  quote: string
  range?: RangeEnd
  bound?: Bound
  /** The id of the range's other end (set when ids are given, session.ts). */
  rangeWith?: string
}

/** Characters of context kept before and after a price. */
const BEFORE = 90
const AFTER = 60

/** The words around a match, cut at word boundaries, always holding the whole match. */
function around(t: string, start: number, end: number): string {
  let from = Math.max(0, start - BEFORE)
  let to = Math.min(t.length, end + AFTER)
  if (from > 0) {
    const space = t.indexOf(" ", from)
    from = space >= 0 && space < start ? space + 1 : from
  }
  if (to < t.length) {
    const space = t.lastIndexOf(" ", to)
    to = space > end ? space : to
  }
  return t.slice(from, to).trim()
}

/** The prices in a result's snippet, then its page text: at most `max` (a range's high end past it), each amount once. */
export function priceCandidates(result: SearchResult, max = 4): PriceCandidate[] {
  const out: PriceCandidate[] = []
  for (const text of [result.snippet, result.content ?? ""]) {
    const t = plain(text)
    for (const p of priceMatches(t)) {
      const lowKept = p.range?.side === "high" && out.some((c) => c.range?.side === "low" && sameAmount(c, p.range!.other))
      if (out.length >= max && !lowKept) return out
      const have = out.find((c) => sameAmount(c, p))
      if (have) {
        // Seen before on its own: it keeps its place, and now knows its range or bound.
        if (!have.range && !have.bound) Object.assign(have, p.range ? { range: p.range, quote: around(t, p.start, p.end) } : p.bound ? { bound: p.bound } : {})
        continue
      }
      out.push({
        ...(p.range ? { range: p.range } : {}),
        ...(p.bound ? { bound: p.bound } : {}),
        currency: p.currency,
        amount: p.amount,
        scale: p.scale,
        value: scaleUp(p.amount, SCALES[p.scale]),
        source_url: result.url,
        site: siteOf(result.url),
        title: result.title,
        quote: around(t, p.start, p.end),
      })
    }
  }
  return out
}

const sameAmount = (a: FoundPrice, b: FoundPrice) => a.currency === b.currency && a.amount === b.amount && a.scale === b.scale

/** The first `n` prices, with a range's high end added when its low end is the last one in. */
export function firstPrices<P extends PriceCandidate>(prices: readonly P[], n: number): P[] {
  const out = prices.slice(0, n)
  const last = out.at(-1)
  const next = prices[n]
  if (last?.range?.side === "low" && next?.range?.side === "high" && next.source_url === last.source_url && sameAmount(next, last.range.other)) out.push(next)
  return out
}

/** An amount with `zeros` more digits, exactly (decimal point moved, never floating point). */
export function scaleUp(amount: string, zeros: number): string {
  const [whole = "0", fraction = ""] = amount.split(".")
  const digits = whole + fraction.padEnd(zeros, "0")
  const point = whole.length + zeros
  return normalizeNumber(`${digits.slice(0, point)}.${digits.slice(point)}`)
}

/** The site's name as shown beside a figure: the host without "www.". */
export const siteOf = (url: string) => new URL(url).hostname.replace(/^www\./, "")

/** Keeps a figure only when its own result states it; otherwise says why it was dropped. */
export function verifyWebFigure(figure: WebFigureInput, results: readonly SearchResult[]): { ok: true; figure: KeptWebFigure } | { ok: false; reason: DropReason } {
  const result = results.find((r) => r.url === figure.source_url)
  if (!result) return { ok: false, reason: "unknown_url" }
  const quote = flat(figure.quote)
  const inText = [result.snippet, result.content ?? ""].some((t) => flat(t).includes(quote))
  if (!inText) return { ok: false, reason: "quote_not_found" }
  const amount = normalizeNumber(figure.amount)
  const stated = pricesIn(quote).some((p) => p.currency === figure.currency && p.amount === amount && p.scale === figure.scale)
  if (!stated) return { ok: false, reason: "amount_not_in_quote" }
  const value = scaleUp(amount, SCALES[figure.scale])
  return { ok: true, figure: { ...figure, amount, value, site: siteOf(result.url), title: result.title } }
}
