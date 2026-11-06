import { z } from "zod"
import { VEHICLE_CATALOGUE, countryName, normalizePlace, tripPlaceScope } from "@fin-creador/schemas"

// Web lookup queries (Sprint 10.8) are built here from a fixed template, never written by the
// model. The model fills fixed fields; every variable word comes from a list in code:
//   * a trip's destination from 10.5's known-place list (tripPlaceScope): an unlisted place
//     means no search;
//   * a vehicle's make and model from VEHICLE_CATALOGUE (a listed model may carry digits,
//     such as "XUV700": the catalogue's own name, not something the person typed);
//   * the month as its name only; nights and travellers are small integers used for totals in
//     code and never written into the query; the person's country by its listed name.
// Then the query as a whole is checked: letters, spaces and listed names only, no amounts or
// currency symbols, and nothing matching the person's own words (display name, email,
// account and category names, recent descriptions). Any failure: no search.

export const WEB_TRIP_LINES = ["transport", "stay", "food", "activities", "visa"] as const
export type WebTripLine = (typeof WEB_TRIP_LINES)[number]

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const placeText = z.string().trim().min(1).max(40)

const tripLookup = z
  .object({
    kind: z.literal("trip"),
    destination: placeText,
    month,
    nights: z.number().int().min(1).max(30),
    travellers: z.number().int().min(1).max(9),
    cost_line: z.enum(WEB_TRIP_LINES),
  })
  .strict()

const vehicleLookup = z
  .object({
    kind: z.literal("vehicle"),
    vehicle: z.enum(["bike", "car", "hmv"]),
    make: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(40).optional(),
    month,
  })
  .strict()

export type WebLookupInput = z.infer<typeof tripLookup> | z.infer<typeof vehicleLookup>

/** Only the fields that were given: the per-kind schemas are strict. */
const given = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined))

/** The lookup as one of its two kinds; throws on a mix (webLookupInput has already refused one). */
export const toLookup = (v: Record<string, unknown>): WebLookupInput =>
  v.kind === "trip" ? tripLookup.parse(given(v)) : vehicleLookup.parse(given(v))

/**
 * The model-facing input: one flat object, because a tool's input schema must be an object at
 * the top (a union is refused by the provider). Which fields a kind needs, and that no other
 * kind's fields are sent, is checked against the two strict schemas above.
 */
export const webLookupInput = z
  .object({
    kind: z.enum(["trip", "vehicle"]),
    destination: placeText.optional().describe("Trip: where, as the person said it. Must be a listed country, Indian state or city."),
    month: month.describe("Travel or purchase month, YYYY-MM."),
    nights: z.number().int().min(1).max(30).optional().describe("Trip only."),
    travellers: z.number().int().min(1).max(9).optional().describe("Trip only."),
    cost_line: z.enum(WEB_TRIP_LINES).optional().describe("Trip only: one cost line to look up."),
    vehicle: z.enum(["bike", "car", "hmv"]).optional().describe("Vehicle only."),
    make: z.string().trim().min(1).max(40).optional().describe("Vehicle only: a make from the app's vehicle list."),
    model: z.string().trim().min(1).max(40).optional().describe("Vehicle only: a model of that make from the app's list."),
  })
  .strict()
  .superRefine((v, ctx) => {
    const parsed = (v.kind === "trip" ? tripLookup : vehicleLookup).safeParse(given(v))
    if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path })
  })

export type WebLookupFields = z.infer<typeof webLookupInput>


/** The person's own words that must never reach a search provider. */
export type PrivateTerms = {
  /** Display name and email: any one of their words is enough to refuse. */
  names: readonly string[]
  /** Account and category names and recent descriptions: refused when one is in the query. */
  phrases: readonly string[]
}

export type BuiltQuery =
  | { ok: true; query: string; subject: string; scope?: "domestic" | "international" }
  | { ok: false; reason: "unlisted_place" | "unlisted_item" | "line_not_for_scope" | "private" | "unsafe" }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

const monthName = (yyyyMm: string) => MONTHS[Number(yyyyMm.slice(5, 7)) - 1]!

/** Same shape as normalizePlace: lower case, no accents, single spaces. */
const wordsOf = (text: string) => normalizePlace(text).split(" ").filter((w) => w.length >= 3)

/** The listed name a typed name matches, exactly as the list writes it. */
function listedName(list: readonly string[], typed: string): string | null {
  const key = normalizePlace(typed)
  return list.find((name) => normalizePlace(name) === key) ?? null
}

/** The place as written for the query: its letters and single spaces, as the person wrote it. */
function placeForQuery(destination: string): string | null {
  const cleaned = destination.normalize("NFKC").replace(/\s+/g, " ").trim()
  if (!/^[\p{L}][\p{L} .'-]{0,39}$/u.test(cleaned) || cleaned.split(" ").length > 4) return null
  return cleaned
}

function tripQuery(line: WebTripLine, place: string, scope: "domestic" | "international", monthText: string, country: string | null): string | null {
  switch (line) {
    case "transport":
      return scope === "international" && country ? `return flight price from ${country} to ${place} in ${monthText}` : `flight ticket price to ${place} in ${monthText}`
    case "stay":
      return `average hotel price per night in ${place} in ${monthText}`
    case "food":
      return `average daily food cost per person in ${place}`
    case "activities":
      return `popular tours and activities prices in ${place}`
    case "visa":
      if (scope !== "international") return null
      return country ? `${place} tourist visa fee for ${country} passport holders` : `${place} tourist visa fee`
  }
}

/** Whether a query's variable part carries any of the person's own words. */
export function mentionsPrivate(query: string, terms: PrivateTerms): boolean {
  const queryWords = new Set(wordsOf(query))
  for (const name of terms.names) {
    // An email's local part splits into words like a name ("meera.k" → "meera").
    for (const w of wordsOf(name.split("@")[0] ?? "")) if (queryWords.has(w)) return true
  }
  const padded = ` ${normalizePlace(query)} `
  for (const phrase of terms.phrases) {
    const p = normalizePlace(phrase)
    if (p.length >= 3 && padded.includes(` ${p} `)) return true
  }
  return false
}

/** The final query's shape: letters, spaces and the catalogue's own model names; no amount or currency sign. */
function isSafeQuery(query: string, allowedDigits: readonly string[]): boolean {
  if (query.length > 120) return false
  if (/[\p{Sc}@#%&/\\:]/u.test(query)) return false
  const digits = query.match(/\p{N}+/gu) ?? []
  return digits.every((d) => allowedDigits.some((a) => a.includes(d)))
}

/**
 * The query for one lookup, or why there is none. `country` is the profile's country code
 * (named by the list, India for "IN"), never typed.
 */
export function buildQuery(input: WebLookupInput, terms: PrivateTerms, countryCode: string | null): BuiltQuery {
  // countryName gives the code back for an unlisted one: then no country is written.
  const country = countryCode && countryName(countryCode) !== countryCode ? countryName(countryCode) : null
  const monthText = monthName(input.month)
  let query: string | null
  let subject: string
  let scope: "domestic" | "international" | undefined
  let allowedDigits: string[] = []

  if (input.kind === "trip") {
    scope = tripPlaceScope(input.destination) ?? undefined
    const place = placeForQuery(input.destination)
    if (!scope || !place) return { ok: false, reason: "unlisted_place" }
    query = tripQuery(input.cost_line, place, scope, monthText, country)
    if (!query) return { ok: false, reason: "line_not_for_scope" }
    subject = place
  } else {
    const catalogue = VEHICLE_CATALOGUE[input.vehicle]
    const make = listedName(Object.keys(catalogue), input.make)
    if (!make) return { ok: false, reason: "unlisted_item" }
    const model = input.model === undefined ? null : listedName(catalogue[make] ?? [], input.model)
    if (input.model !== undefined && !model) return { ok: false, reason: "unlisted_item" }
    subject = model ? `${make} ${model}` : make
    allowedDigits = model ? [model] : []
    query = `${subject} on road price${country ? ` in ${country}` : ""} ${monthText}`
  }

  // The template's own words ("food", "hotel") may match a category; only the variable part
  // can carry the person's words.
  if (mentionsPrivate(subject, terms)) return { ok: false, reason: "private" }
  if (!isSafeQuery(query, allowedDigits)) return { ok: false, reason: "unsafe" }
  return { ok: true, query, subject, ...(scope ? { scope } : {}) }
}
