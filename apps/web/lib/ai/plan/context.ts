import type { SearchResult } from "../search/types"
import { siteOf } from "../search/verify"
import { PAGE_WORDS, hotelNameAt, isSiteName } from "./names"

// What a plan's figures are for (10.9), found in code in the same result text as the price,
// never written by the model:
//   * a price's `about`: the hotel or area for a nightly rate, the kind of meal for food, the
//     mode for local travel, the place for sightseeing; the words nearest the price in its own
//     quote. Nothing found: the price is shown without it, never with a guess.
//   * a line's `mentions`: named local dishes (food), well-known places (sightseeing) and what a
//     place is known for buying (shopping), from the lists and patterns here, each with the
//     page it was found on.

const MEAL_KINDS: [RegExp, string][] = [
  [/\bstreet[- ]food\b/i, "street food"],
  [/\bthalis?\b/i, "thali"],
  [/\bfine[- ]dining\b/i, "fine dining"],
  [/\bmid[- ]range restaurants?\b/i, "mid-range restaurant"],
  [/\b(?:budget|cheap|inexpensive) (?:restaurants?|eateries|meals?)\b/i, "budget restaurant"],
  [/\bmeal for two\b/i, "meal for two"],
  [/\bbuffets?\b/i, "buffet"],
  [/\bcaf[eé]s?\b/i, "café"],
  [/\bbreakfast\b/i, "breakfast"],
  [/\blunch\b/i, "lunch"],
  [/\bdinner\b/i, "dinner"],
  [/\b(?:local|roadside) (?:eateries|restaurants?|dhabas?)\b|\bdhabas?\b/i, "local eatery"],
]

const MODES: [RegExp, string][] = [
  [/\blocal trains?\b|\bsuburban trains?\b/i, "local train"],
  [/\bmetro\b|\bMRT\b|\bBTS\b|\bsubway\b/, "metro"],
  [/\b(?:Uber|Ola|Rapido|Grab|Bolt|app[- ]based cabs?|app cabs?)\b/i, "app cab"],
  [/\bauto[- ]?rickshaws?\b|\bautos?\b|\btuk[- ]?tuks?\b/i, "auto"],
  [/\bbus(?:es)?\b/i, "bus"],
  [/\bferr(?:y|ies)\b/i, "ferry"],
  [/\b(?:scooter|bike|moped|two[- ]wheeler) (?:rental|hire)s?\b|\brent(?:ing)? a (?:scooter|bike)\b/i, "scooter rental"],
  [/\b(?:taxis?|cabs?|car hire|car rental)\b/i, "taxi"],
]

/** Named dishes looked for in the food results (a list, so a name is never made up). */
export const DISHES = [
  "vada pav", "pav bhaji", "misal pav", "bombil fry", "bhel puri", "pani puri", "sev puri", "biryani", "masala dosa", "dosa", "idli", "vada",
  "fish curry", "fish thali", "prawn curry", "bebinca", "xacuti", "vindaloo", "cafreal", "sorpotel", "momos", "thukpa", "dal baati", "laal maas",
  "ghewar", "kachori", "chole bhature", "butter chicken", "rogan josh", "appam", "puttu", "karimeen", "dal bhat", "litti chokha", "rasgulla",
  "mishti doi", "dhokla", "khandvi", "poha", "jalebi", "pho", "banh mi", "bun cha", "pad thai", "tom yum", "som tam", "mango sticky rice",
  "sushi", "ramen", "tempura", "okonomiyaki", "satay", "laksa", "nasi goreng", "nasi lemak", "chilli crab", "hainanese chicken rice",
  "kottu", "hoppers", "dumplings", "shawarma", "falafel", "hummus", "croissant", "crepes",
] as const

/** What places are known for buying (a list, matched in the shopping results). */
export const SHOPPING_ITEMS = [
  "cashews", "spices", "feni", "handicrafts", "handloom", "textiles", "silk sarees", "sarees", "pashmina", "shawls", "carpets", "rugs", "gemstones",
  "silver jewellery", "jewellery", "leather goods", "leather", "tea", "coffee", "pottery", "bangles", "block prints", "bandhani", "kolhapuri chappals",
  "attar", "perfume", "lacquerware", "wooden toys", "brassware", "madhubani paintings", "paintings", "souvenirs", "batik", "lanterns", "silk",
  "electronics", "cosmetics", "chocolates", "gold", "antiques", "clothes", "kurtas", "street fashion", "local wine", "port wine",
] as const

const ATTRACTION_WORDS = "Fort|Palace|Temple|Museum|Beach|Falls|Caves?|Gateway|Gate|Bazaar|Gardens?|Lake|Market|Church|Basilica|Cathedral|Mosque|Island|Point|Tower|Bridge|Minar|Mahal|Sanctuary|National Park|Ghat|Dam|Hill|Valley|Monastery|Stupa|Square|Zoo|Aquarium|Waterfall"
const CAP = "[A-Z][\\p{L}'’.-]*"
const ATTRACTION = new RegExp(`(?:${CAP}\\s+){0,3}(?:${ATTRACTION_WORDS})\\b(?:\\s+(?:of\\s+)?${CAP}){0,2}`, "gu")
const GENERIC_FIRST = new Set(["best", "top", "popular", "famous", "the", "this", "these", "most", "visit", "explore", "a", "an", "our", "your", "every", "all", "many"])

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const textsOf = (r: SearchResult) => [r.title, r.snippet, r.content ?? ""]

/** Where the price sits in its quote: the first number whose digits are the amount's. */
function priceAt(quote: string, amount: string): number {
  const digits = amount.replace(/\D/g, "")
  for (const m of quote.matchAll(/\d[\d,.]*/g)) if (m[0].replace(/\D/g, "").startsWith(digits)) return m.index
  return Math.floor(quote.length / 2)
}

/**
 * The label from `list` written nearest the price in its quote. The list goes from specific to
 * general: a match inside an earlier one's words ("cab" in "app cab") doesn't count.
 */
function nearest(quote: string, at: number, list: readonly [RegExp, string][]): string | undefined {
  const taken: [number, number][] = []
  let best: { d: number; label: string } | null = null
  for (const [re, label] of list) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)
    for (const m of quote.matchAll(g)) {
      const end = m.index + m[0].length
      if (taken.some(([a, b]) => m.index >= a && end <= b)) continue
      taken.push([m.index, end])
      const d = end <= at ? at - end : Math.abs(m.index - at)
      if (!best || d < best.d) best = { d, label }
    }
  }
  return best?.label
}

/** A place name nearest the price in its quote ("Gateway of India", "Baga Beach"). */
function attractionNear(quote: string, at: number): string | undefined {
  let best: { d: number; name: string } | null = null
  for (const m of quote.matchAll(ATTRACTION)) {
    const name = cleanPlace(m[0])
    if (!name) continue
    // A name before the price is as far as its last word, one after it as far as its first.
    const end = m.index + m[0].length
    const d = end <= at ? at - end : Math.abs(m.index - at)
    if (!best || d < best.d) best = { d, name }
  }
  return best?.name
}

function cleanPlace(raw: string): string | null {
  let words = raw.replace(/\s+/g, " ").replace(/[.’'-]+$/, "").trim().replace(/^The /, "").split(" ")
  while (words.length > 0 && PAGE_WORDS.has(words[0]!.toLowerCase())) words = words.slice(1)
  const name = words.join(" ")
  // A page title ("Tour Mumbai Dhobi Ghat Tour Mumbai") isn't a place: no page words, no repeats.
  const lower = words.map((w) => w.toLowerCase())
  if (words.length < 2 || words.length > 5 || name.length > 60 || GENERIC_FIRST.has(lower[0]!) || isSiteName(name)) return null
  if (lower.some((w) => PAGE_WORDS.has(w)) || new Set(lower).size < lower.length) return null
  return name
}

/** An area named with "in" before the price ("in Colaba"), when no hotel is. */
function areaNear(quote: string, at: number): string | undefined {
  let best: { d: number; name: string } | null = null
  for (const m of quote.matchAll(/\bin ([A-Z][\p{L}'’-]+(?: [A-Z][\p{L}'’-]+)?)/gu)) {
    const d = Math.abs(m.index - at)
    if (!/^(?:January|February|March|April|May|June|July|August|September|October|November|December|India)$/.test(m[1]!) && (!best || d < best.d)) best = { d, name: m[1]! }
  }
  return best?.name
}

/** What one price is for, from its own quote; undefined when nothing there says. */
export function aboutPrice(line: string, quote: string, amount: string, destination: string | null): string | undefined {
  const at = priceAt(quote, amount)
  switch (line) {
    case "stay": {
      const hotel = hotelNameAt(quote, at)
      if (hotel) return hotel
      const area = areaNear(quote, at)
      return area && (!destination || area.toLowerCase() !== destination.toLowerCase()) ? area : undefined
    }
    case "food":
      return nearest(quote, at, MEAL_KINDS)
    case "local_travel":
      return nearest(quote, at, MODES)
    case "sightseeing":
      return attractionNear(quote, at)
    default:
      return undefined
  }
}

export type Mention = { name: string; site: string; url: string }

/** Names from `list` found in the results, each once, with the first page that names it. */
function listed(results: readonly SearchResult[], list: readonly string[], max: number): Mention[] {
  const out: Mention[] = []
  for (const r of results) {
    for (const text of textsOf(r)) {
      for (const name of list) {
        if (out.some((m) => m.name === name || m.name.includes(name))) continue
        // "cashews" matches "cashew" too: a plural on the list is optional in the text.
        const word = name.endsWith("s") ? `${escape(name.slice(0, -1))}s?` : escape(name)
        if (new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "iu").test(text)) out.push({ name, site: siteOf(r.url), url: r.url })
      }
    }
  }
  return out.slice(0, max)
}

export const dishesIn = (results: readonly SearchResult[]) => listed(results, DISHES, 6)
export const shoppingIn = (results: readonly SearchResult[]) => listed(results, SHOPPING_ITEMS, 8)

/** Well-known places named in the sightseeing results, priced or not, each once. */
export function placesIn(results: readonly SearchResult[]): Mention[] {
  const out: Mention[] = []
  for (const r of results) {
    for (const text of textsOf(r)) {
      for (const m of text.matchAll(ATTRACTION)) {
        const name = cleanPlace(m[0])
        if (name && !out.some((o) => o.name.toLowerCase() === name.toLowerCase())) out.push({ name, site: siteOf(r.url), url: r.url })
      }
    }
  }
  return out.slice(0, 8)
}
