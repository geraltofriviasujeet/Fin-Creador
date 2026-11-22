import {
  type BellReminder,
  type LedgerItem,
  type RecurringView,
  type TransactionsContext,
  type TransactionTotals,
  entryKindLabel,
  entryTitle,
  fullDate,
  ledgerLookup,
  signedAmount,
} from "@fin-creador/api"
import { formatMoney, formatMoneyWhole, summarizeHoldings } from "@fin-creador/domain"
import { type OfflineSnapshot, SNAPSHOT_LIMITS } from "./snapshot"

// Builds the offline snapshot (lib/pwa/snapshot.ts) from figures the server already loads for
// the Overview: the same holdings rule as "Total available", the same whole-rupee month
// totals as the Overview cards, the same entry text as the lists. Pure: the route
// (app/api/offline-snapshot) loads the data under RLS and passes it in.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "November 2026" for a YYYY-MM-DD date. */
function monthLabel(today: string): string {
  const [y, m] = today.split("-").map(Number) as [number, number]
  return `${MONTHS[m - 1]} ${y}`
}

/** "6:42 pm, 22 Nov 2026" in the person's time zone. */
export function takenLabel(at: Date, timeZone: string): string {
  const parts = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone, ...options }).format(at)
  return `${parts({ hour: "numeric", minute: "2-digit", hour12: true })}, ${parts({ day: "numeric", month: "short", year: "numeric" })}`
}

export type SnapshotInput = {
  userId: string
  now: Date
  context: Pick<TransactionsContext, "today" | "currency" | "timeZone" | "accounts" | "loanAccounts" | "categories">
  /** This month's totals (transaction_summary). */
  month: TransactionTotals
  /** The latest entries, newest first (voided ones excluded). */
  recent: readonly LedgerItem[]
  /** Null when the recurring rules couldn't be loaded. */
  recurring: RecurringView | null
  /** Loan, card and statutory dues (the bell's list), or null. */
  reminders: readonly BellReminder[] | null
}

export function buildOfflineSnapshot({ userId, now, context, month, recent, recurring, reminders }: SnapshotInput): OfflineSnapshot {
  const { currency, today, timeZone } = context
  const lookup = ledgerLookup(context)
  const holdings = summarizeHoldings(context.accounts, currency)

  type Due = { name: string; sortDate: string; date: string; amount: string | null }
  const dues: Due[] = []
  for (const item of [...(recurring?.due ?? []), ...(recurring?.soon ?? [])]) {
    if (!item.date) continue
    dues.push({ name: entryTitle(item.entry, lookup), sortDate: item.date, date: fullDate(item.date), amount: signedAmount(item.entry) })
  }
  for (const r of reminders ?? []) {
    if (!r.dueDate) continue
    dues.push({
      name: `${r.name} · ${r.label}`,
      sortDate: r.dueDate,
      date: fullDate(r.dueDate),
      amount: r.amountMinor === null ? null : formatMoney(r.amountMinor, { currency: r.currency }),
    })
  }
  dues.sort((a, b) => a.sortDate.localeCompare(b.sortDate))

  return {
    v: 1,
    userId,
    takenAt: now.toISOString(),
    takenLabel: takenLabel(now, timeZone),
    totalAvailable: formatMoney(holdings.totalAvailableMinor, { currency }),
    accounts: holdings.rows.slice(0, SNAPSHOT_LIMITS.accounts).map((r) => ({
      name: r.account.label,
      balance: formatMoney(r.balanceMinor, { currency: r.account.currency }),
    })),
    month: {
      label: monthLabel(today),
      income: formatMoneyWhole(month.incomeMinor, { currency }),
      spent: formatMoneyWhole(month.expenseMinor, { currency }),
    },
    dues: dues.slice(0, SNAPSHOT_LIMITS.dues).map(({ name, date, amount }) => ({ name, date, amount })),
    entries: recent
      .filter((e) => !e.voided)
      .slice(0, SNAPSHOT_LIMITS.entries)
      .map((e) => ({ date: fullDate(e.occurredOn), name: entryTitle(e, lookup), category: entryKindLabel(e, lookup), amount: signedAmount(e) })),
  }
}
