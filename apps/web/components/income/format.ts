import { formatMoney } from "@fin-creador/domain"

export const money = (minor: number, currency: string) => formatMoney(minor, { currency })

/** "₹" for INR, "$" for USD: the prefix shown inside amount inputs. */
export function currencySymbol(currency: string) {
  try {
    return (
      new Intl.NumberFormat("en-IN", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? currency
    )
  } catch {
    return currency
  }
}

/** "22 Oct 2026" for an ISO date (calendar date, no time-zone shift). */
export function shortDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`)
  )
}

/** "22 Oct 2026" for an instant, in the user's time zone. */
export function shortDateTime(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(instant))
}

/**
 * A random v4 UUID used as the idempotency key. randomUUID() exists only in secure
 * contexts (HTTPS, localhost); getRandomValues() works everywhere.
 */
export function newRequestKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
