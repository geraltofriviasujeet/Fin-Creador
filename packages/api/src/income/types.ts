import type { AccountWithActivity, IncomeEntry, IncomeSource, IsoDate } from "@fin-creador/domain"

// Data for the Income screen, shared by web and mobile. Calculations happen in
// packages/domain; these are the inputs plus display labels.

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
  /** The user's local date from the database (user_local_today), used for every period. */
  today: IsoDate
  accounts: IncomeAccount[]
  sources: IncomeSourceItem[]
  /** Income since the earlier of 1 January and the start of last month, newest first. */
  entries: IncomeEntryItem[]
}

/** Result of a save, without UI concerns (web adds echoed values; mobile shows it in a sheet). */
export type WriteResult =
  | { status: "success"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> }
