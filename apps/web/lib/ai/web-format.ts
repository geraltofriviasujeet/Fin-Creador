// How Roma's web estimates are written on screen (10.8): the currency as found, never
// converted; digits grouped for reading only (the amounts stay decimal strings).

const SCALE_WORDS: Record<string, string> = { none: "", thousand: " thousand", lakh: " Lakh", crore: " crore", million: " million" }
const PER_WORDS: Record<string, string> = {
  total: "",
  night: " a night",
  person: " a person",
  person_night: " a person a night",
  day_person: " a person a day",
}

/** "1234567.5" as "12,34,567.5" for INR, "1,234,567.5" otherwise. */
export function groupDigits(amount: string, currency: string): string {
  const [whole = "0", fraction] = amount.split(".")
  const grouped = BigInt(whole).toLocaleString(currency === "INR" ? "en-IN" : "en-US")
  return fraction ? `${grouped}.${fraction}` : grouped
}

/** A web amount without what it covers: "INR 7.4 Lakh", "GBP 60". */
export function webAmount(f: { amount: string; scale: string; currency: string }): string {
  return `${f.currency} ${groupDigits(f.amount, f.currency)}${SCALE_WORDS[f.scale] ?? ""}`
}

const BOUND_WORDS: Record<string, string> = { from: "from ", up_to: "up to " }

/** A web price as found: "INR 7.4 Lakh", "GBP 60 a night", "from INR 3,413 a person". */
export function webPrice(f: { amount: string; scale: string; currency: string; per: string; bound?: string }): string {
  return `${f.bound ? (BOUND_WORDS[f.bound] ?? "") : ""}${webAmount(f)}${PER_WORDS[f.per] ?? ""}`
}

/**
 * A web total: one amount, or "low to high" when the cost lines' prices ranged. Fed by a "from"
 * price it is a minimum ("at least" its low end); by an "up to" price a maximum ("at most" its
 * high end); by both, the range said as neither.
 */
export function webTotal(t: { currency: string; low: string; high: string; bound?: string }): string {
  const low = groupDigits(t.low, t.currency)
  const high = groupDigits(t.high, t.currency)
  if (t.bound === "at_least") return `at least ${t.currency} ${low}`
  if (t.bound === "at_most") return `at most ${t.currency} ${high}`
  const amount = t.low === t.high ? `${t.currency} ${low}` : `${t.currency} ${low} to ${high}`
  return t.bound === "mixed" ? `${amount} (mixes "from" and "up to" prices: neither a minimum nor a maximum)` : amount
}
