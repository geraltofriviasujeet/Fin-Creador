import { currencyMinorDigits } from "@fin-creador/domain"

// Exchange rates for plans (10.9 follow-up): a fixed table in code, so a price found in another
// currency joins the plan's one total. The daily refresh-prices job reads only AMFI's NAV file
// and BSE's bhavcopy, neither of which publishes exchange rates, so there is no live source;
// the table is refreshed with the quarterly list refresh (docs/quarterly-list-refresh.md).
//   * The amount converted is the one read from the page and checked against it; conversion
//     is arithmetic here, exact in integers, rounded once to the target's minor units.
//   * A currency not in the table (JPY, say) is never converted: its prices aren't used.
//   * The rate and its date are stated in the plan's assumptions, as approximate.

/** When the rates were taken, and from where. */
export const RATES_ON = "2026-11-08"
export const RATES_SOURCE = "open.er-api.com, checked against the ECB's reference rates"

/** Rupees for one unit, as decimals. INR is the pivot: other pairs go through it. */
export const INR_PER: Readonly<Record<string, string>> = {
  INR: "1",
  USD: "94.1176",
  EUR: "105.031",
  GBP: "125.9129",
  AED: "25.6266",
  THB: "2.804",
  SGD: "73.3999",
  MYR: "23.2051",
  LKR: "0.2835",
  NPR: "0.625",
}

export const canConvert = (from: string, to: string) => from === to || (from in INR_PER && to in INR_PER)

/** A decimal string as an integer and its places ("94.1176" is 941176 and 4). */
function parts(d: string): [bigint, number] {
  const [whole, frac = ""] = d.split(".")
  return [BigInt(`${whole}${frac}`), frac.length]
}

/**
 * `amount` (a decimal, any scale already applied) in `from`, in `to`: rounded half away from
 * zero to `to`'s minor units, as a decimal. Null when either currency has no rate.
 */
export function convertDecimal(amount: string, from: string, to: string): string | null {
  if (!canConvert(from, to)) return null
  if (from === to) return amount
  const [a, aPlaces] = parts(amount)
  const [f, fPlaces] = parts(INR_PER[from]!)
  const [t, tPlaces] = parts(INR_PER[to]!)
  const digits = currencyMinorDigits(to)
  // amount × from's rupees ÷ to's rupees, in `to`'s minor units.
  const num = a * f * 10n ** BigInt(tPlaces + digits)
  const den = t * 10n ** BigInt(aPlaces + fPlaces)
  const minor = (num * 2n + den) / (den * 2n)
  const s = minor.toString().padStart(digits + 1, "0")
  return digits === 0 ? s : `${s.slice(0, -digits)}.${s.slice(-digits)}`.replace(/\.?0+$/, "")
}

/** "1 USD = INR 94.1176" for each currency, as the assumptions state them. */
export const rateWords = (codes: readonly string[]) => codes.filter((c) => c !== "INR" && c in INR_PER).map((c) => `1 ${c} = INR ${INR_PER[c]}`)
