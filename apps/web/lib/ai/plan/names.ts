import type { SearchResult } from "../search/types"
import { type PriceCandidate, siteOf } from "../search/verify"

// Names in a plan (10.9), found in code in the results a lookup retrieved, never typed by the
// model. Each gets an id; the model picks ids, and the plan shows each name with the page it
// was found on, as "listed on <site>", not as Roma's recommendation.
//   * Carriers: only names on CARRIERS below, found in the carriers lookup's results (title,
//     snippet or page text). A name the list doesn't have is never offered.
//   * Hotels: a run of capitalised words with a lodging word in it ("Taj Exotica Resort &
//     Spa"), with "4-star" or "5-star" (or four-, five-star) written in the same sentence,
//     within STAR_WINDOW characters of it, so one hotel's stars are never another's. For a
//     budget plan the stars aren't required (budget hotels are named without them). Generic phrases ("Best Hotels", "Luxury Resorts") are
//     not names. A nightly rate is attached only when a price found in code on that page has
//     this name as the hotel nearest it in its own quote (never a neighbour's rate). A name with a site or domain in it ("Mumbai Booking.com Hotel")
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
export const PAGE_WORDS = new Set(["apply", "filter", "filters", "share", "sort", "book", "view", "deals", "deal", "price", "prices", "search", "login", "sign", "menu", "show", "select", "compare", "reviews", "photos", "map", "save", "offer", "offers", "tour", "tours", "cheap", "cheapest"])

/** The name with a leading "The" kept only when it is part of it ("The Leela Palace"). */
function cleanName(raw: string): string | null {
  let words = raw.replace(/\s+/g, " ").replace(/[.’'-]+$/, "").trim().split(" ")
  // A sentence's end before a name is cut ("Calangute Beach. Moon Light Retreat"; "St." is kept),
  // then page words before it ("Apply The Leela Palace"); one inside it means it isn't one.
  const sentenceEnd = words.slice(0, -1).findLastIndex((w) => /^\p{L}{4,}\.$/u.test(w))
  words = words.slice(sentenceEnd + 1)
  while (words.length > 0 && (PAGE_WORDS.has(words[0]!.toLowerCase()) || /^\p{Ll}/u.test(words[0]!))) words = words.slice(1)
  if (words.some((w) => PAGE_WORDS.has(w.toLowerCase()))) return null
  const name = words.join(" ")
  if (isSiteName(name) || CARD_WORDS.has(words[0]!.toLowerCase())) return null
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
export function hotelCandidates(
  results: readonly SearchResult[],
  prices: readonly (PriceCandidate & { id: string })[],
  destination: string | null = null,
  needStars = true,
): NameCandidate[] {
  const out: NameCandidate[] = []
  for (const r of results) {
    for (const text of textsOf(r)) {
      for (const m of text.matchAll(HOTEL_NAME)) {
        const name = cleanName(m[0])
        if (!name || out.some((h) => nameKey(h.name, destination) === nameKey(name, destination))) continue
        const stars = starsNear(text, m.index, m.index + m[0].length)
        if (!stars && needStars) continue
        const rate = prices.find((p) => p.source_url === r.url && hotelNameAt(p.quote, priceAt(p.quote, p.amount)) === name)
        out.push({ id: "", name, site: siteOf(r.url), url: r.url, quote: quoteAt(text, m.index, m[0].length), ...(stars ? { stars } : {}), ...(rate ? { rateId: rate.id } : {}) })
      }
    }
  }
  return out.slice(0, NAMES_PER_KIND).map((h, i) => ({ ...h, id: `h${i + 1}` }))
}

/**
 * A hotel's own page's name, from its title's first part ("Hotel Savera, Chennai | Official
 * Site" is "Hotel Savera"). A listing ("Hotels in Chennai", "10 Best Hotels in Chennai") or a
 * name that is only the destination and lodging words isn't one.
 */
export function pageHotelName(title: string, destination: string | null): string | undefined {
  const first = title.split(/\s+[|–—:-]\s+|,\s+/)[0]!.trim()
  if (/\d/.test(first) || /\b(?:in|near|from|for|best|top|cheap|budget|deals?)\b/i.test(first) || /\b(?:Hotels|Resorts|Villas|Suites)\b$/.test(first)) return undefined
  const m = first.match(new RegExp(`^${HOTEL_NAME.source}$`, "u"))
  const name = m ? cleanName(m[0]) : null
  return name && nameKey(name, destination) ? name : undefined
}

/** A rupee price in page text, to find where the card before a price ends. */
const RUPEE_PRICE = /(?:₹|\brs\.?|\binr)\s?\d[\d,]*(?:\.\d+)?/gi
/** How far back a listing card's name may be from its price. */
const CARD_CHARS = 350

/**
 * The hotel a listing page's price is for (10.9 follow-up): the name nearest before it, in its
 * own card (after the price before it). A listing card names its hotel twice, by its photo and
 * its heading ("The Park Chennai - Chennai - Balcony The Park Chennai Chennai, TN, India ...
 * ₹ 10,313+"), so a name repeated in the card is taken first, the longest; else a name with a
 * lodging word ("Hotel Akmg Towers"). Nothing found: undefined, never a guess.
 */
export function listingHotelAt(text: string, at: number, destination: string | null): string | undefined {
  const from = Math.max(0, at - CARD_CHARS)
  let start = from
  for (const m of text.slice(from, at).matchAll(RUPEE_PRICE)) start = from + m.index + m[0].length
  const card = text.slice(start, at)
  const lodging = lodgingNameIn(card)
  // A listing's heading ("Chennai Hotels") is no hotel's name.
  return repeatedName(card, destination) ?? (lodging && !/s$/.test(lodging) && nameKey(lodging, destination) ? lodging : undefined)
}

function repeatedName(card: string, destination: string | null): string | undefined {
  const words = [...card.matchAll(/[\p{L}\p{N}][\p{L}\p{N}&'’.-]*/gu)].map((m) => ({ w: m[0], at: m.index, end: m.index + m[0].length }))
  // Words next to each other with only spaces between: a name never runs across " - " or ",".
  const joined = (i: number, n: number) => words.slice(i, i + n - 1).every((x, k) => /^ +$/.test(card.slice(x.end, words[i + k + 1]!.at)))
  const phrase = (i: number, n: number) => words.slice(i, i + n).map((x) => x.w).join(" ")
  // The name is repeated most (photo, its caption, heading: "Balcony The Park Chennai" twice,
  // "The Park Chennai" three times), then the one written first ("The Raintree, St. Mary's
  // Road"), then the longest ("Taj Club House", not "Club House").
  let best: { name: string; times: number; first: number; n: number } | null = null
  for (let n = 7; n >= 2; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      if (!joined(i, n)) continue
      const p = phrase(i, n)
      let times = 0
      for (let j = 0; j + n <= words.length; j++) {
        if (!joined(j, n) || phrase(j, n) !== p) continue
        times++
        j += n - 1
      }
      if (times < 2 || !isCardName(p, destination)) continue
      const first = words[i]!.at
      if (!best || times > best.times || (times === best.times && (first < best.first || (first === best.first && n > best.n)))) best = { name: p, times, first, n }
    }
  }
  return best?.name
}

/** Words that join a sentence, never inside a card's name ("in Chennai", "rates in Chennai"). */
const JOINING = new Set(["in", "at", "for", "from", "to", "with", "on", "near", "is", "are", "was", "and", "or", "per", "a", "an", "rates", "price", "average"])

/** A listing card's amenities and buttons, never its hotel's name. */
const CARD_WORDS = new Set(["parking", "free", "wi-fi", "wifi", "pool", "spa", "pet-friendly", "breakfast", "gym", "availability", "cancellation", "airport", "shuttle", "very", "good", "wonderful", "excellent", "okay"])

function isCardName(name: string, destination: string | null): boolean {
  const words = name.split(" ")
  const lower = words.map((w) => w.toLowerCase())
  // "The" leads a name only before a word that isn't generic ("The Park Chennai", not "The best").
  const lead = lower[0] === "the" ? lower[1] : lower[0]
  if (!lead || /\d/.test(name) || isSiteName(name) || lower.some((w) => PAGE_WORDS.has(w) || JOINING.has(w)) || GENERIC.has(lead) || CARD_WORDS.has(lead)) return false
  // A lower-case first word only in a brand of three words or more ("ibis Chennai Sipcot"), never "in Chennai".
  if (/^\p{Ll}/u.test(words[0]!) && words.length < 3) return false
  if (lower.filter((w) => CARD_WORDS.has(w)).length * 2 >= words.length) return false
  // Mostly capitalised ("ibis Chennai Sipcot" is), and more than the destination and lodging words.
  if (words.filter((w) => /^\p{Lu}/u.test(w)).length * 2 < words.length) return false
  return nameKey(name, destination) !== ""
}

function lodgingNameIn(card: string): string | undefined {
  let last: string | undefined
  for (const m of card.matchAll(HOTEL_NAME)) last = cleanName(m[0]) ?? last
  return last
}

/** Where the price sits in its quote: the first number whose digits are the amount's. */
export function priceAt(quote: string, amount: string): number {
  // The number that is the amount ("₹800", not the "₹8,000" before it), else one starting with its digits.
  const numbers = [...quote.matchAll(/\d[\d,.]*/g)]
  const exact = numbers.find((m) => m[0].replace(/,/g, "").replace(/\.$/, "").replace(/\.0+$/, "") === amount)
  if (exact) return exact.index
  const digits = amount.replace(/\D/g, "")
  for (const m of numbers) if (m[0].replace(/\D/g, "").startsWith(digits)) return m.index
  return Math.floor(quote.length / 2)
}

/**
 * The hotel a price is for (a nightly rate's label), if any: one named in the price's own
 * sentence first ("Taj Exotica ... from ₹18,000 a night. Novotel ..." is Taj Exotica's), then
 * the nearest in its quote.
 */
export function hotelNameAt(quote: string, at: number): string | undefined {
  let start = 0
  let stop = quote.length
  for (const m of quote.matchAll(SENTENCE_END)) {
    if (m.index < at) start = m.index + 1
    else {
      stop = m.index
      break
    }
  }
  let best: { own: boolean; d: number; name: string } | null = null
  for (const m of quote.matchAll(HOTEL_NAME)) {
    const name = cleanName(m[0])
    if (!name) continue
    const end = m.index + m[0].length
    const own = m.index >= start && end <= stop + 1
    const d = m.index > at ? m.index - at : Math.max(0, at - end)
    if (!best || (own && !best.own) || (own === best.own && d < best.d)) best = { own, d, name }
  }
  return best?.name
}
