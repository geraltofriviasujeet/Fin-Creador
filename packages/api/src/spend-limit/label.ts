import { DEFAULT_LOCALE, floorToWholeMinor, formatMoney, formatMoneyWhole } from "@fin-creador/domain"
import type { SpendLimit } from "./load"

// What the person set, for the "Set daily spend limit" button once a limit exists (owner,
// 2026-11-27): "₹1,000 / day", "₹7,000 / week", "₹30,000 / month", "₹5,000 / 10 days".
// A whole amount shows no paise; an amount with paise shows them, so it is never misstated.
// Hermes-safe: the domain formatters fall back to their own string formatting.

export function spendLimitLabel(limit: Pick<SpendLimit, "amountMinor" | "currency" | "period" | "periodDays">): string {
  const options = { currency: limit.currency, locale: DEFAULT_LOCALE }
  const isWhole = floorToWholeMinor(limit.amountMinor, limit.currency) === limit.amountMinor
  const amount = isWhole ? formatMoneyWhole(limit.amountMinor, options) : formatMoney(limit.amountMinor, options)
  const per = limit.period === "custom" ? `${limit.periodDays ?? 0} days` : limit.period
  return `${amount} / ${per}`
}
