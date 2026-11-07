import type { SearchResult } from "../search/types"
import { type PriceCandidate, siteOf } from "../search/verify"

// Names in a plan (10.9), found in code in the results a lookup retrieved, never typed by the
// model. Each gets an id; the model picks ids, and the plan shows each name with the page it
// was found on, as "listed on <site>", not as Roma's recommendation.
//   * Carriers: only names on CARRIERS below, found in the carriers lookup's results (title,
//     snippet or page text). A name the list doesn't have is never offered.
//   * Hotels: a run of capitalised words with a lodging word in it ("Taj Exotica Resort &
//     Spa"), with "4-star" or "5-star" (or four-, five-star) written in the same sentence,
//     within STAR_WINDOW characters of it, so one hotel's stars are never another's. Generic phrases ("Best Hotels", "Luxury Resorts") are
//     not names. A nightly rate is attached only when a price found in code on that page has
//     the name in its own quote. A name with a site or domain in it ("Mumbai Booking.com Hotel")
//     is not a hotel's name; names are kept once, compared without "The", the place's own name
//     or a trailing "Hotel" ("The Taj Mahal Palace" and "Taj Mahal Palace Mumbai" are one).

export const CARRIERS = [
  "Air India Express",
  "Air India",
  "IndiGo",
  "Akasa Air",
  "SpiceJet",
  "Alliance Air",
  "Star Air",
  "Fly91",
  "FlyBig",
  "Emirates",
  "Qatar Airways",
  "Etihad Airways",
  "flydubai",
  "Air Arabia",
  "Gulf Air",
  "Oman Air",
  "Saudia",
  "Singapore Airlines",
  "Scoot",
  "Thai Airways",
  "Thai AirAsia",
  "AirAsia",
  "Batik Air",
  "Malaysia Airlines",
  "Vietnam Airlines",
  "VietJet Air",
  "Japan Airlines",
  "All Nippon Airways",
  "Cathay Pacific",
  "SriLankan Airlines",
  "Nepal Airlines",
  "Biman Bangladesh Airlines",
  "Drukair",
  "Turkish Airlines",
  "Lufthansa",
  "British Airways",
  "Air France",
  "KLM",
  "Virgin Atlantic",
  "United Airlines",
  "American Airlines",
  "Air Canada",
  "Qantas",
  "Air New Zealand",
] as const

/** At most this many names of each kind are offered to the model. */
export const NAMES_PER_KIND = 8
const STAR_WINDOW = 150

export type NameCandidate = { id: string; name: string; site: string; url: string; quote: string; stars?: 4 | 5; rateId?: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const textsOf = (r: SearchResult) => [r.title, r.snippet, r.content ?? ""]

/** The words around `at` in `text`, for the model to judge by. */
function quoteAt(text: string, at: number, length: number): string {
  return text.slice(Math.max(0, at - 80), Math.min(text.length, at + length + 80)).replace(/\s+/g, " ").trim()
}

/** Carriers on the list named in the results, each once, from the first page that names it. */
export function carrierCandidates(results: readonly SearchResult[]): NameCandidate[] {
  const out: NameCandidate[] = []
  for (const r of results) {
    for (const text of textsOf(r)) {
      // Longest names first, blanked once found, so "Air India Express" isn't also "Air India".
      let rest = text
      for (const name of CARRIERS) {
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "iu")
        const m = re.exec(rest)
        if (!m) continue
        rest = rest.slice(0, m.index) + " ".repeat(m[0].length) + rest.slice(m.index + m[0].length)
        if (out.some((c) => c.name === name)) continue
        out.push({ id: "", name, site: siteOf(r.url), url: r.url, quote: quoteAt(text, m.index, m[0].length) })
      }
    }
  }
  return out.slice(0, NAMES_PER_KIND).map((c, i) => ({ ...c, id: `c${i + 1}` }))
}

const LODGING = "Hotel|Hotels|Resort|Resorts|Palace|Retreat|Suites|Spa|Villas|Inn|Lodge"
const CAP = "[A-Z][\\p{L}'’.-]*"
// Lower-case joining words inside a name ("Courtyard by Marriott") are allowed, never at its start.
const HOTEL_NAME = new RegExp(`(?:(?:${CAP}|by|of|de|la)\\s+){0,4}(?:${LODGING})(?:\\s+(?:&\\s+|and\\s+)?${CAP}){0,3}`, "gu")
/** First words that make a phrase generic, not a name. */
const GENERIC = new Set(["best", "top", "luxury", "cheap", "budget", "popular", "book", "find", "compare", "star", "hotels", "resorts", "list", "new", "great", "beach", "family", "all", "our", "these", "other", "more", "and", "the"])
const STARS = /\b(?:([45])\s?-?\s?star|(four|five)[\s-]star)\b/gi

/** A sentence ends at . ! or ? before a space and a capital ("₹14.5" doesn't end one). */
const SENTENCE_END = /[.!?](?=\s+[A-Z])/g

/** The stars written nearest a name in its own sentence, within STAR_WINDOW characters, if any. */
function starsNear(text: string, at: number, end: number): 4 | 5 | undefined {
  let start = 0
  let stop = text.length
  for (const m of text.matchAll(SENTENCE_END)) {
    if (m.index < at) start = m.index + 1
    else if (m.index >= end) {
      stop = m.index
      break
    }
  }
  const from = Math.max(start, at - STAR_WINDOW)
  const window = text.slice(from, Math.min(stop, end + STAR_WINDOW))
  let best: { d: number; stars: 4 | 5 } | null = null
  for (const m of window.matchAll(STARS)) {
    const stars = (m[1] === "5" || m[2]?.toLowerCase() === "five" ? 5 : 4) as 4 | 5
    const pos = from + m.index
    const d = pos < at ? at - pos : Math.max(0, pos - end)
    if (!best || d < best.d) best = { d, stars }
  }
  return best?.stars
}

/** Booking and review sites, and anything shaped like a domain: never part of a hotel's name. */
const SITES = /\b(?:booking|agoda|makemytrip|goibibo|expedia|tripadvisor|trivago|hotels\.com|airbnb|cleartrip|yatra|kayak|oyo|easemytrip|ixigo|skyscanner)\b|\b[\w-]+\.(?:com|in|net|org|co|io|travel)\b/i
export const isSiteName = (name: string) => SITES.test(name)

/** One key per hotel: without "The", the destination's words, "Hotel(s)" or punctuation. */
export function nameKey(name: string, destination: string | null): string {
  const drop = new Set(["the", "hotel", "hotels", ...(destination ?? "").toLowerCase().split(/\s+/).filter(Boolean)])
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !drop.has(w))
    .join(" ")
}

/** Words of a booking page's buttons and filters, never part of a hotel's name ("Apply", "Filter By"). */
export const PAGE_WORDS = new Set(["apply", "filter", "filters", "share", "sort", "book", "view", "deals", "deal", "price", "prices", "search", "login", "sign", "menu", "show", "select", "compare", "reviews", "photos", "map", "save", "offer", "offers", "tour", "tours"])

/** The name with a leading "The" kept only when it is part of it ("The Leela Palace"). */
function cleanName(raw: string): string | null {
  let words = raw.replace(/\s+/g, " ").replace(/[.’'-]+$/, "").trim().split(" ")
  // Page words before a name are cut ("Apply The Leela Palace"); one inside it means it isn't one.
  while (words.length > 0 && (PAGE_WORDS.has(words[0]!.toLowerCase()) || /^\p{Ll}/u.test(words[0]!))) words = words.slice(1)
  if (words.some((w) => PAGE_WORDS.has(w.toLowerCase()))) return null
  const name = words.join(" ")
  if (isSiteName(name)) return null
  if (words.length < 2 || words.length > 7 || name.length > 80) return null
  const first = words[0]!.toLowerCase()
  if (first === "the" ? words.length < 3 || GENERIC.has(words[1]!.toLowerCase()) : GENERIC.has(first)) return null
  // A name has at least one word that isn't a lodging word.
  if (words.every((w) => new RegExp(`^(?:${LODGING}|&|and|The)$`).test(w))) return null
  return name
}

/**
 * 4- and 5-star hotels and resorts named in the results, each once; `prices` are the prices
 * found in code in the same results (with their ids), for a nightly rate quoted with the name.
 */
export function hotelCandidates(results: readonly SearchResult[], prices: readonly (PriceCandidate & { id: string })[], destination: string | null = null): NameCandidate[] {
  const out: NameCandidate[] = []
  for (const r of results) {
    for (const text of textsOf(r)) {
      for (const m of text.matchAll(HOTEL_NAME)) {
        const name = cleanName(m[0])
        if (!name || out.some((h) => nameKey(h.name, destination) === nameKey(name, destination))) continue
        const stars = starsNear(text, m.index, m.index + m[0].length)
        if (!stars) continue
        const rate = prices.find((p) => p.source_url === r.url && p.quote.includes(name))
        out.push({ id: "", name, site: siteOf(r.url), url: r.url, quote: quoteAt(text, m.index, m[0].length), stars, ...(rate ? { rateId: rate.id } : {}) })
      }
    }
  }
  return out.slice(0, NAMES_PER_KIND).map((h, i) => ({ ...h, id: `h${i + 1}` }))
}

/** The hotel named nearest a price in its quote (for a nightly rate's label), if any. */
export function hotelNameAt(quote: string, at: number): string | undefined {
  let best: { d: number; name: string } | null = null
  for (const m of quote.matchAll(HOTEL_NAME)) {
    const name = cleanName(m[0])
    if (!name) continue
    const d = m.index > at ? m.index - at : Math.max(0, at - (m.index + m[0].length))
    if (!best || d < best.d) best = { d, name }
  }
  return best?.name
}
