import type { SearchResult } from "../search/types"
import { siteOf } from "../search/verify"
import { CARRIERS, PAGE_WORDS, hotelNameAt, isSiteName, pageHotelName, priceAt } from "./names"

// What a plan's figures are for (10.9), found in code in the same result text as the price,
// never written by the model:
//   * a price's `about`: the airline for transport, the hotel or property for a nightly rate,
//     the kind of meal for food, the mode for local travel, the place or tour for sightseeing;
//     the words nearest the price in its own quote, else what its page is about, from the
//     page's title and address (aboutPage). Nothing found: the price isn't used (a price
//     without what it is for means nothing), never shown with a guess.
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

/** A daily food figure, only when no kind of meal is named in the quote ("food costs ₹800 a day"). */
const DAILY_FOOD: [RegExp, string][] = [
  [/\bdaily (?:food|meals?)\b|\b(?:food|meals?)\b[^.]{0,40}?\b(?:per|a) day\b|\b(?:per|a) day\b[^.]{0,20}?\bon (?:food|meals?)\b/i, "food for a day"],
]

const MODES: [RegExp, string][] = [
  [/\blocal trains?\b|\bsuburban trains?\b/i, "local train"],
  [/\bmetro\b|\bMRT\b|\bBTS\b|\bsubway\b/, "metro"],
  [/\b(?:Uber|Ola|Rapido|Grab|Bolt|app[- ]based cabs?|app cabs?)\b/i, "app cab"],
  [/\bauto[- ]?rickshaws?\b|\bautos?\b|\btuk[- ]?tuks?\b/i, "auto"],
  [/\bbus(?:es)?\b/i, "bus"],
  [/\bferr(?:y|ies)\b/i, "ferry"],
  [/\b(?:scooter|bike|moped|two[- ]wheeler) (?:rental|hire)s?\b|\brent(?:ing)? a (?:scooter|bike)\b/i, "scooter hire"],
  [/\b(?:taxis?|cabs?|car hire|car rental)\b/i, "taxi"],
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Airlines, from the carriers list (longer names first there, so "Air India Express" isn't "Air India"). */
const AIRLINES: [RegExp, string][] = CARRIERS.map((name) => [new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "iu"), name])

/** Tours and activities a sightseeing price can be for, when no place is named nearer. */
const TOURS: [RegExp, string][] = [
  [/\bsunset cruises?\b/i, "sunset cruise"],
  [/\briver cruises?\b/i, "river cruise"],
  [/\bdolphin (?:watching|trips?|tours?|cruises?)\b/i, "dolphin trip"],
  [/\bspice (?:plantation|farm) (?:tours?|visits?)\b/i, "spice plantation tour"],
  [/\bheritage walks?\b/i, "heritage walk"],
  [/\bwalking tours?\b/i, "walking tour"],
  [/\bcity tours?\b/i, "city tour"],
  [/\bboat (?:tours?|rides?|trips?)\b/i, "boat tour"],
  [/\bdesert safaris?\b/i, "desert safari"],
  [/\b(?:jeep |wildlife )?safaris?\b/i, "safari"],
  [/\bsnorkell?ing\b/i, "snorkelling"],
  [/\bscuba diving\b/i, "scuba diving"],
  [/\bparasailing\b/i, "parasailing"],
  [/\b(?:white[- ]water )?rafting\b/i, "rafting"],
  [/\bcable car\b|\bropeway\b/i, "cable car"],
  [/\bhot[- ]air balloon\b/i, "hot-air balloon"],
  [/\blight and sound show\b/i, "light and sound show"],
  [/\bcooking class(?:es)?\b/i, "cooking class"],
  [/\btrek(?:king)?\b/i, "trek"],
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

const textsOf = (r: SearchResult) => [r.title, r.snippet, r.content ?? ""]

/**
 * The label from `list` written nearest the price in its quote. The list goes from specific to
 * general: a match inside an earlier one's words ("cab" in "app cab") doesn't count.
 */
function nearest(quote: string, at: number, list: readonly [RegExp, string][]): string | undefined {
  return nearestAt(quote, at, list)?.label
}

function nearestAt(quote: string, at: number, list: readonly [RegExp, string][]): { d: number; label: string } | null {
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
  return best
}

/** A place name nearest the price in its quote ("Gateway of India", "Baga Beach"). */
function attractionNear(quote: string, at: number): { d: number; name: string } | null {
  let best: { d: number; name: string } | null = null
  for (const m of quote.matchAll(ATTRACTION)) {
    const name = cleanPlace(m[0])
    if (!name) continue
    // A name before the price is as far as its last word, one after it as far as its first.
    const end = m.index + m[0].length
    const d = end <= at ? at - end : Math.abs(m.index - at)
    if (!best || d < best.d) best = { d, name }
  }
  return best
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

/** What a line's price must say it is for, in words ("which airline"), for a line that needs one. */
export const SUBJECT_WORDS: Partial<Record<string, string>> = {
  transport: "which airline",
  stay: "which hotel or property",
  food: "what kind of meal or food",
  local_travel: "which way of getting around",
  sightseeing: "which place or tour",
}

/** What one price is for, from its own quote; undefined when nothing there says. */
export function aboutPrice(line: string, quote: string, amount: string): string | undefined {
  const at = priceAt(quote, amount)
  switch (line) {
    case "transport":
      return nearest(quote, at, AIRLINES)
    case "stay":
      return hotelNameAt(quote, at)
    case "food":
      return nearest(quote, at, MEAL_KINDS) ?? nearest(quote, at, DAILY_FOOD)
    case "local_travel":
      return nearest(quote, at, MODES)
    case "sightseeing": {
      // The place or the tour named nearer the price.
      const place = attractionNear(quote, at)
      const tour = nearestAt(quote, at, TOURS)
      if (place && (!tour || place.d <= tour.d)) return place.name
      return tour?.label
    }
    default:
      return undefined
  }
}

/** Words of a page's address: its host without "www." and its top-level part, and its path. */
function addressWords(url: string): { host: string; path: string } {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase().replace(/^www\./, "").split(".").slice(0, -1).join(" ")
    return { host, path: decodeURIComponent(u.pathname).replace(/[^\p{L}\p{N}]+/gu, " ") }
  } catch {
    return { host: "", path: "" }
  }
}

/** Ways of getting around run together in a site's name ("droptaxi", "murugancabs"). */
const HOST_MODES: [RegExp, string][] = [
  [/taxi|cab(?!in)/, "taxi"],
  [/metro/, "metro"],
]

/**
 * A food page with no kind of meal named: its title or address is about food, or it is a
 * cost-of-living or food-cost guide ("cost of food in X", "food prices in X", "budget for meals
 * in X", "cost of living in X"), where per-day food figures are. A guide's rent or bus fare is
 * still dropped: food is a per-day line, and those aren't per day (unitAt).
 */
const FOOD_PAGE = /\b(?:food|foods|meals?|restaurants?|dining|eat(?:ing)?|eateries|street food|cost[- ]of[- ]living|living costs?)\b/i

const first = (text: string, list: readonly [RegExp, string][]) => list.find(([re]) => re.test(text))?.[1]

/**
 * What a price is for when its own words don't say: what its page is about, from its title and
 * address, of the kind the line's lookup asked for (a taxi firm's page for local travel, a
 * hotel's own page for a stay, a "cost of food" guide for food). A page that names none of
 * them says nothing, and the price stays unused.
 */
export function aboutPage(line: string, title: string, url: string, destination: string | null = null): string | undefined {
  const { host, path } = addressWords(url)
  const squashed = host.replace(/[^a-z]/g, "")
  switch (line) {
    case "transport":
      return first(title, AIRLINES) ?? CARRIERS.find((c) => squashed.includes(c.toLowerCase().replace(/[^a-z]/g, "")))
    case "stay":
      return pageHotelName(title, destination)
    case "food":
      return first(title, MEAL_KINDS) ?? (FOOD_PAGE.test(title) || FOOD_PAGE.test(path) ? "food" : undefined)
    case "local_travel":
      return first(title, MODES) ?? first(path, MODES) ?? first(squashed, HOST_MODES)
    case "sightseeing":
      return attractionNear(title, 0)?.name ?? first(title, TOURS)
    default:
      return undefined
  }
}

/** What a price is charged per, as written next to it. */
export type PriceUnit = "day" | "night" | "km" | "hour" | "trip" | "month" | "outstation" | "add_on"

/** A unit written right after a price ("₹2,000 per day", "₹1,400 / 4 hrs"); "a person" or "per head" before it is skipped. */
const UNIT_AFTER: [RegExp, PriceUnit | "hours"][] = [
  [/^(?:per|\/|a|each)\s?(?:km|kms|kilomet)/, "km"],
  [/^(?:\/|for|per)\s?(\d{1,2})\s?(?:hrs?|hours?)\b/, "hours"],
  [/^(?:per|\/|an?|each)\s?(?:hr|hour)/, "hour"],
  [/^(?:per|\/|a|each)\s?day\b|^daily\b/, "day"],
  [/^(?:per|\/|a|each)\s?(?:room\s)?night\b|^nightly\b/, "night"],
  [/^(?:per|\/|a)\s?month\b|^monthly\b/, "month"],
  [/^(?:per|\/|a)\s?(?:trip|ride|transfer|drop)\b|^one[- ]way\b/, "trip"],
]

/** A unit in the words just before a price, in its own table cell or clause ("Price per kilometer | Rs 25", "Driver batta / day ₹600"). */
const UNIT_BEFORE: [RegExp, PriceUnit | "hours"][] = [
  [/\b(?:per|extra|add(?:itional)?|\/)\s?(?:km|kms|kilomet\w*)\b/g, "km"],
  // A package: "8 hrs / 80 km", "8 hrs & 80 kms".
  [/\b(\d{1,2})\s?(?:hrs?|hours?)\s*[/&·,]\s*\d+\s?kms?\b/g, "hours"],
  [/\b(?:per|extra|\/)\s?(?:hr|hour)s?\b|\bwaiting\b|\bhourly\b/g, "hour"],
  [/\bbase (?:fee|fare)\b|\bminimum fare\b|\bper (?:trip|ride|transfer|drop)\b|\bone[- ]way\b|\bairport (?:drop|transfer|pick-?up)\b/g, "trip"],
  [/\bmonthly\b|\b(?:per|\/|a)\s?month\b/g, "month"],
  [/\b(?:per|\/|a)\s?day\b|\bdaily\b|\bfull[- ]day\b|\bday rate\b/g, "day"],
  [/\b(?:per|\/|a)\s?night\b|\bnightly\b/g, "night"],
]

/** A package of so many hours: 8 or more is a day's hire (the "8 hrs / 80 km" day), fewer is by the hour. */
const hours = (n: string): PriceUnit => (Number(n) >= 8 ? "day" : "hour")

const PRICE_MARK = /(?:₹|\brs\.?|\binr)\s?\d[\d,]*(?:\.\d+)?/gi

/**
 * The unit written next to a price in its quote: right after it, else in the words just before
 * it (back to the price or cell before); undefined when none is written there. An outstation
 * rate or an add-on charge named just before it is that, whatever unit follows.
 */
export function unitAt(quote: string, amount: string): PriceUnit | undefined {
  const at = priceAt(quote, amount)
  const number = /\d[\d,]*(?:\.\d+)?/.exec(quote.slice(at))
  const end = at + (number ? number[0].length : 0)
  // Before: from the last price (or sentence end) before this one, the last two table cells.
  const window = quote.slice(Math.max(0, at - 60), at)
  // This price's own mark ("₹", "Rs") is at the window's end; a price before it ends earlier.
  const previous = [...window.matchAll(PRICE_MARK)].filter((m) => m.index + m[0].length < window.length - 4).at(-1)
  let before = previous ? window.slice(previous.index + previous[0].length) : window
  before = before.split(/[.!?]\s+(?=[A-Z])|·/).at(-1)!
  before = before.split("|").map((c) => c.trim()).filter((c) => c && !/^-+$/.test(c)).slice(-2).join(" | ").toLowerCase()
  // An outstation (intercity) rate is per day too, but not for getting around the place itself.
  if (/\boutstation\b|\bintercity\b/.test(before)) return "outstation"
  // A charge on top of the fare (the driver's allowance, tolls) isn't the hire itself.
  if (/\bbatta\b|\bdriver(?:'s)? allowance\b|\btolls?\b|\b(?:hill station|night|toll|parking|permit|waiting) charges?\b/.test(before)) return "add_on"
  const after = quote
    .slice(end, end + 40)
    .toLowerCase()
    .split(/[|·₹]|\brs\b|\binr\b|\.\s/)[0]!
    .replace(/^\s*(?:\/-|\+|\)|onwards|only)?\s*/, "")
    .replace(/^(?:(?:per|a|each)\s(?:person|head|adult)|pp)\s*,?\s*/, "")
  for (const [re, unit] of UNIT_AFTER) {
    const m = re.exec(after)
    if (m) return unit === "hours" ? hours(m[1]!) : unit
  }
  let best: { end: number; unit: PriceUnit } | null = null
  for (const [re, unit] of UNIT_BEFORE) {
    for (const m of before.matchAll(re)) {
      const e = m.index + m[0].length
      if (!best || e > best.end) best = { end: e, unit: unit === "hours" ? hours(m[1]!) : unit }
    }
  }
  return best?.unit
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
