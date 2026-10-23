import type { BankType, EntryType, IsoDate, LedgerEntry, PeriodTotals } from "@fin-creador/domain"
import type { PaymentModeValue } from "@fin-creador/schemas"

export type { EntryType }

/** An account as the Transactions screens need it (balance from account_balances). */
export type LedgerAccount = {
  id: string
  kind: "bank" | "cash" | "other"
  bankType: BankType | null
  label: string
  currency: string
  openingBalanceMinor: number
  openingBalanceDate: IsoDate
  inflowMinor: number
  outflowMinor: number
  archived: boolean
}

/** An expense category or an income source. `icon` is the expense icon or the source type. */
export type LedgerCategory = {
  id: string
  kind: "expense" | "income"
  name: string
  icon: string
  archived: boolean
}

/** One version of an entry, as listed. */
export type LedgerItem = LedgerEntry & {
  note: string | null
  paymentMode: PaymentModeValue | null
  /** Raw database timestamp; never parsed (see PageCursor). */
  createdAt: string
  voidReason: string | null
}

export type TransactionsContext = {
  today: IsoDate
  currency: string
  timeZone: string
  accounts: LedgerAccount[]
  categories: LedgerCategory[]
  /** For fast entry: a new expense starts from the account of the latest expense. */
  lastExpenseAccountId: string | null
  /** Whether the person has any entry at all (empty state vs "nothing matches"). */
  hasEntries: boolean
}

export type TransactionTotals = PeriodTotals
