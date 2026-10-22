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

// One idempotency key per opened form; shared with the mobile app.
export { newRequestKey } from "@fin-creador/api"
