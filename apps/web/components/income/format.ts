import { formatMoney, formatMoneyWhole } from "@fin-creador/domain"

export const money = (minor: number, currency: string) => formatMoney(minor, { currency })
/** Account balances on the Income page: always two decimals (₹1,33,390.00), so a column aligns. */
export const balance = (minor: number, currency: string) => formatMoney(minor, { currency, trimZeroFraction: false })
/** Chart labels and income amounts: whole rupees, rounded half away from zero (packages/domain). */
export const whole = (minor: number, currency: string) => formatMoneyWhole(minor, { currency })

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
