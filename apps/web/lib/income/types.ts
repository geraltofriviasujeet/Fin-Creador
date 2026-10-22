import type { AccountWithActivity, IncomeEntry, IncomeSource, IsoDate } from "@fin-creador/domain"

// Serializable data for the Income page (server → client). Calculations happen in
// packages/domain; these are just the inputs plus display labels.

export type IncomeAccount = AccountWithActivity & {
  name: string
  institution: string | null
  last4: string | null
  /** "HDFC Bank ··4821", or the name. */
  label: string
  /** ISO timestamp of the latest change (account edit or entry). */
  lastActivityAt: string
}

export type IncomeSourceItem = IncomeSource

export type IncomeEntryItem = IncomeEntry & {
  note: string | null
  voidReason: string | null
}

export type IncomePageData = {
  currency: string
  timeZone: string
  today: IsoDate
  accounts: IncomeAccount[]
  sources: IncomeSourceItem[]
  /** Income since the earlier of 1 January and the start of last month, newest first. */
  entries: IncomeEntryItem[]
}
