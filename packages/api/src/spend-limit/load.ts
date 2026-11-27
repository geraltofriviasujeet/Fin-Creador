import { SPEND_LIMIT_PERIODS, type SpendLimitPeriod } from "@fin-creador/schemas"
import type { UserClient } from "../income/client"

// The signed-in person's daily spend limit (migration 20261127120000_spend_limits.sql), read
// under RLS. The daily figure and the period's spending are worked out in packages/domain.

export type SpendLimit = {
  amountMinor: number
  /** The profile currency when it was last saved; a limit in another currency is not used. */
  currency: string
  period: SpendLimitPeriod
  /** 1 (day), 7 (week), 2–365 (custom); null for a month. */
  periodDays: number | null
  /** First day of the first period (the person's local date); periods repeat from it. */
  startsOn: string
}

export type SpendLimitLoad = { ok: true; data: SpendLimit | null } | { ok: false; reason: "unavailable" }

const isPeriod = (value: string): value is SpendLimitPeriod => (SPEND_LIMIT_PERIODS as readonly string[]).includes(value)

/** The limit, or null when none is set. A row that doesn't match the table's rules is treated as unavailable. */
export async function loadSpendLimit(supabase: UserClient): Promise<SpendLimitLoad> {
  const { data, error } = await supabase.from("spend_limits").select("amount_minor, currency, period, period_days, starts_on").maybeSingle()
  if (error) return { ok: false, reason: "unavailable" }
  if (!data) return { ok: true, data: null }
  if (!isPeriod(data.period) || !Number.isSafeInteger(data.amount_minor) || data.amount_minor <= 0) return { ok: false, reason: "unavailable" }
  return {
    ok: true,
    data: { amountMinor: data.amount_minor, currency: data.currency, period: data.period, periodDays: data.period_days, startsOn: data.starts_on },
  }
}
