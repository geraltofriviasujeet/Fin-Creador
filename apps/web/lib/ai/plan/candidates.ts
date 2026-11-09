import { VEHICLE_CATALOGUE } from "@fin-creador/schemas"
import { compareDecimals } from "../search/totals"
import type { SearchResult } from "../search/types"
import { type PriceMatch, SCALES, plain, priceMatchesIn, scaleUp, siteOf } from "../search/verify"

// Model shortlists for a purchase plan (10.9 follow-up), found in code, never typed by the
// model. A candidate is a make and model on VEHICLE_CATALOGUE written on a page (the make
// first, as listing pages write it: "Royal Enfield Hunter 350"), paired with the first rupee
// price after it in its own card: before the next listed model and within CARD_CHARS. A price
// is never borrowed from a neighbour's card. Each model is kept once, from the first page that
// prices it. A price is dropped and counted when it is a monthly figure (an EMI), in another
// currency, or outside the purchase's plausible range (both ends of a range must be inside):
// "₹30,500" for a car is an accessory or an EMI, never the car. Beyond the name and the price,
// only what the same card says: engine cc, mileage (kmpl) or an EV's range, fuel, seats and a
// body word; "ex-showroom" only when the card says so. Nothing is inferred.

export type ModelItem = "bike" | "car"

/** How far after a model's name its price may be, in its own card. */
const CARD_CHARS = 300
/** At most this many candidates are offered to the model. */
export const CANDIDATES_OFFERED = 12

export type ModelCandidate = {
  id: string
  make: string
  model: string
  /** The price as found (rupees, its scale applied): one figure, or a range's ends. */
  low: string
  high: string
  bound?: "from" | "up_to"
  exShowroom: boolean
  /** The card's own facts, as short phrases ("125 cc", "65 kmpl", "Petrol", "SUV"). */
  facts: string[]
  site: string
  url: string
  /** The card's words around the name and price, for the model to judge the use by. */
  quote: string
}

export type CandidateDrops = { unpriced: number; monthly: number; otherCurrency: number; outOfRange: number }

/** Other ways pages write a make. */
const MAKE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "Maruti Suzuki": ["Maruti Suzuki", "Maruti"],
  "Mercedes-Benz": ["Mercedes-Benz", "Mercedes Benz", "Mercedes"],
  "Harley-Davidson": ["Harley-Davidson", "Harley Davidson"],
  "Ola Electric": ["Ola Electric", "Ola"],
  Volkswagen: ["Volkswagen", "VW"],
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** A name's spaces and hyphens match either ("Pulsar N160", "FZ S"). */
const loose = (s: string) => escape(s).replace(/[\s-]+/g, "[\\s-]?")

type Pattern = { make: string; model: string; re: RegExp }

const patterns = new Map<ModelItem, Pattern[]>()
function patternsFor(item: ModelItem): Pattern[] {
  const have = patterns.get(item)
  if (have) return have
  const out: Pattern[] = []
  for (const [make, models] of Object.entries(VEHICLE_CATALOGUE[item])) {
    const makes = (MAKE_ALIASES[make] ?? [make]).map(loose).join("|")
    for (const model of models) out.push({ make, model, re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${makes})[\\s-]+${loose(model)}(?![\\p{L}\\p{N}+])`, "giu") })
  }
  // Longest models first, so "Activa 125" isn't also "Activa".
  out.sort((a, b) => b.model.length - a.model.length)
  patterns.set(item, out)
  return out
}

type Named = { make: string; model: string; start: number; end: number }

/** Listed models written in the text, in order; a longer name's span isn't matched again. */
function namesIn(t: string, item: ModelItem): Named[] {
  const out: Named[] = []
  for (const p of patternsFor(item)) {
    for (const m of t.matchAll(p.re)) {
      const end = m.index + m[0].length
      if (out.some((n) => m.index < n.end && n.start < end)) continue
      out.push({ make: p.make, model: p.model, start: m.index, end })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

const MONTHLY_AFTER = /^\s?(?:\/\s?(?:mo|month)\b|per month|a month|p\.?\s?m\.?(?![a-z])|onwards? per month|emi\b)/i
const MONTHLY_BEFORE = /\bemi\b[^₹\d]{0,20}$/i

const valueOf = (p: { amount: string; scale: keyof typeof SCALES }) => scaleUp(p.amount, SCALES[p.scale])

/** The facts written in a card, each once, in a fixed order. */
export function factsIn(card: string, item: ModelItem): string[] {
  const out: string[] = []
  const cc = /(?<![\d.])(\d{2,4}(?:\.\d{1,2})?)\s?cc\b/i.exec(card)
  if (cc) out.push(`${cc[1]} cc`)
  const kmpl = /(?<![\d.])(\d{1,3}(?:\.\d{1,2})?)\s?kmpl\b/i.exec(card)
  if (kmpl) out.push(`${kmpl[1]} kmpl`)
  const range = /(?<![\d.])(\d{2,4})\s?km\s?(?:\(?(?:irdc|claimed|certified|arai|midc)\)?\s?)?(?:range|on a single charge|per charge)/i.exec(card) ?? /range(?: of)?\s?(?:up to\s?)?(\d{2,4})\s?km\b/i.exec(card)
  if (range) out.push(`${range[1]} km range`)
  const fuel = /\b(petrol|diesel|cng|electric|hybrid)\b/i.exec(card)
  if (fuel) out.push(fuel[1]![0]!.toUpperCase() + fuel[1]!.slice(1).toLowerCase().replace("cng", "CNG"))
  if (item === "car") {
    const seats = /\b([2-9])[\s-]seat(?:er|s)?\b/i.exec(card)
    if (seats) out.push(`${seats[1]} seats`)
  }
  const body = (item === "car" ? /\b(SUV|sedan|hatchback|MUV|MPV|coupe|convertible|pickup)\b/i : /\b(scooter|cruiser|commuter|sports? bike|adventure|roadster|naked|cafe racer|scrambler)\b/i).exec(card)
  if (body) out.push(/^(suv|muv|mpv)$/i.test(body[1]!) ? body[1]!.toUpperCase() : body[1]!.toLowerCase())
  return out
}

/**
 * Models with a price in the results, each once, ids "m1" on; `range` is the purchase's
 * plausible price in whole rupees (run.ts PURCHASE_SANITY).
 */
export function modelCandidates(
  results: readonly SearchResult[],
  item: ModelItem,
  range: { low: number; high: number },
): { candidates: ModelCandidate[]; drops: CandidateDrops; named: number } {
  const drops: CandidateDrops = { unpriced: 0, monthly: 0, otherCurrency: 0, outOfRange: 0 }
  const out: ModelCandidate[] = []
  const seen = new Set<string>()
  // Why a model wasn't kept, from the first page that names it; one priced on a later page is kept.
  const reasons = new Map<string, keyof CandidateDrops>()
  const low = String(range.low)
  const high = String(range.high)
  for (const r of results) {
    for (const text of [r.snippet, r.content ?? ""]) {
      const t = plain(text)
      const names = namesIn(t, item)
      // Names blanked first (same length, so positions hold): a model's own digits ("Activa 125 Rs. 94,000") are never a price.
      let blanked = t
      for (const n of names) blanked = blanked.slice(0, n.start) + " ".repeat(n.end - n.start) + blanked.slice(n.end)
      const prices = priceMatchesIn(blanked)
      names.forEach((n, i) => {
        const key = `${n.make} ${n.model}`
        if (seen.has(key)) return
        const cardEnd = Math.min(names[i + 1]?.start ?? t.length, n.end + CARD_CHARS)
        const inCard = prices.filter((p) => p.start >= n.end && p.start < cardEnd && p.range?.side !== "high")
        let picked: { p: PriceMatch; drop?: keyof CandidateDrops } | null = null
        for (const p of inCard) {
          if (MONTHLY_AFTER.test(t.slice(p.end, p.end + 24)) || MONTHLY_BEFORE.test(t.slice(Math.max(0, p.start - 30), p.start))) {
            picked ??= { p, drop: "monthly" }
            continue
          }
          picked = { p, ...(p.currency !== "INR" ? { drop: "otherCurrency" as const } : {}) }
          break
        }
        const count = (reason: keyof CandidateDrops) => void (reasons.has(key) || reasons.set(key, reason))
        if (!picked) return count("unpriced")
        if (picked.drop) return count(picked.drop)
        const p = picked.p
        const lo = valueOf(p)
        const hi = p.range ? valueOf(p.range.other) : lo
        if (compareDecimals(lo, low) < 0 || compareDecimals(hi, high) > 0) return count("outOfRange")
        const card = t.slice(n.start, cardEnd)
        seen.add(key)
        out.push({
          id: "",
          make: n.make,
          model: n.model,
          low: lo,
          high: hi,
          ...(p.bound ? { bound: p.bound } : {}),
          exShowroom: /ex[\s-]?showroom/i.test(card),
          facts: factsIn(card, item),
          site: siteOf(r.url),
          url: r.url,
          quote: t.slice(n.start, Math.min(cardEnd, n.start + 220)).trim(),
        })
      })
    }
  }
  for (const [key, reason] of reasons) if (!seen.has(key)) drops[reason]++
  return { candidates: out.slice(0, CANDIDATES_OFFERED).map((c, i) => ({ ...c, id: `m${i + 1}` })), drops, named: new Set([...seen, ...reasons.keys()]).size }
}
