import { formatMoney, formatPercentFromBasisPoints } from "@fin-creador/domain"
import type { Figure, WebBlock } from "./tools/types"
import { webAmount, webTotal } from "./web-format"

// Amounts by placeholder (10.8 follow-up): the model never writes a money amount. Every tool
// figure gets an id ({fig:trip_estimate}) and every kept web price and web total one too
// ({web:3}, {web:total_inr}); the model writes the placeholder and the app puts in the
// formatted amount after the answer has passed the checks. A placeholder this question's
// results don't have is replaced by UNKNOWN_AMOUNT, never guessed. A bare amount the model
// writes anyway still goes through the figure check (output.ts).

export const UNKNOWN_AMOUNT = "[amount left out]"

const PLACEHOLDER = /\{(fig|web):([a-z0-9_]{1,60})\}/g
/** A currency marker the model put next to a placeholder: the amount carries its own. */
const CODES = "rs\\.?|inr|usd|eur|gbp|aed|sgd|thb|vnd|jpy|lkr|npr"
const MARKER_BEFORE = new RegExp(`(?:[₹$€£¥]|\\b(?:${CODES}))\\s?(?=\\{(?:fig|web):)`, "gi")
const MARKER_AFTER = new RegExp(`(?<=\\{(?:fig|web):[a-z0-9_]{1,60}\\})\\s?(?:${CODES}|rupees?)\\b`, "gi")
const withoutMarkers = (text: string) => text.replace(MARKER_BEFORE, "").replace(MARKER_AFTER, "")

export function formatFigure(f: Figure): string {
  if (f.kind === "money") return formatMoney(f.minor, { currency: f.currency })
  if (f.kind === "percent") return formatPercentFromBasisPoints(f.bps)
  return String(f.value)
}

/** A figure's id from its label: "Trip estimate" is "trip_estimate"; a repeat gets "_2", "_3". */
export function figureId(label: string, taken: ReadonlyMap<string, string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48).replace(/_+$/, "") || "figure"
  let id = base
  for (let n = 2; taken.has(`fig:${id}`); n++) id = `${base}_${n}`
  return id
}

/** A kept web price's placeholder key, from its lookup id ("w3" is "web:3"). */
export const webPriceKey = (id: string) => `web:${id.replace(/^w/, "")}`
/** A web total's placeholder key, per currency ("web:total_inr"). */
export const webTotalKey = (currency: string) => `web:total_${currency.toLowerCase()}`

/**
 * The amounts a web block lets an answer refer to, by placeholder key. A price is filled in
 * without what it covers ("a night"): the model says that in its own words, and the web
 * estimates block shows each price in full.
 */
export function webAmounts(block: WebBlock | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!block) return out
  for (const f of block.figures) out.set(webPriceKey(f.id), webAmount(f))
  for (const t of block.totals) out.set(webTotalKey(t.currency), webTotal(t))
  return out
}

/** The text with every placeholder blanked, for the figure and subject checks. */
export function withoutPlaceholders(text: string): string {
  return withoutMarkers(text).replace(PLACEHOLDER, " ")
}

/** The text with each placeholder replaced by its amount; unknown ones by UNKNOWN_AMOUNT. */
export function fillPlaceholders(text: string, amounts: ReadonlyMap<string, string>): { text: string; unknown: string[] } {
  const unknown: string[] = []
  const filled = withoutMarkers(text).replace(PLACEHOLDER, (_m, kind: string, id: string) => {
    const amount = amounts.get(`${kind}:${id}`)
    if (amount !== undefined) return amount
    unknown.push(`${kind}:${id}`)
    return UNKNOWN_AMOUNT
  })
  return { text: filled, unknown }
}
