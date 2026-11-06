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

/** A web price as found: "INR 7.4 Lakh", "GBP 60 a night". */
export function webPrice(f: { amount: string; scale: string; currency: string; per: string }): string {
  return `${f.currency} ${groupDigits(f.amount, f.currency)}${SCALE_WORDS[f.scale] ?? ""}${PER_WORDS[f.per] ?? ""}`
}

/** A web total: one amount, or "low to high" when the cost lines' prices ranged. */
export function webTotal(t: { currency: string; low: string; high: string }): string {
  const low = groupDigits(t.low, t.currency)
  return t.low === t.high ? `${t.currency} ${low}` : `${t.currency} ${low} to ${groupDigits(t.high, t.currency)}`
}
