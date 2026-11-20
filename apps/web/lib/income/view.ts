import {
  type ChartGroup,
  type IncomePeriodKey,
  RATE_WORDS,
  type SourceRateRule,
  formatMoney,
  horizontalBarScale,
  incomeBySource,
  incomeForPeriod,
  monthRange,
  sourceRates,
  summarizeHoldings,
  topGroupsWithOther,
  yearRange,
} from "@fin-creador/domain"
import type { IncomeAccount, IncomePageData } from "./types"

// The Income page's figures, built on the server (page.tsx) from the loader's data with the
// packages/domain rules. The client only switches between these ready-made views: it never
// adds money up. Bar geometry is in basis points of the plot width (display only).

export type Bar = { startBp: number; lengthBp: number }

export type AccountRowView = {
  account: IncomeAccount
  balanceMinor: number
  /** False for an account in another currency: listed with a badge, never totalled or scaled. */
  inTotal: boolean
  typeLabel: string
  /** Null when not in the total (another currency cannot share the rupee axis). */
  bar: Bar | null
}

export type AccountsView = {
  rows: AccountRowView[]
  zeroBp: number
  totalAvailableMinor: number
  moneyInBanksMinor: number
  cashInHandMinor: number
  bankCount: number
  /** Latest change to a cash account (ISO instant), for "As of". */
  cashUpdatedAt: string | null
  archived: IncomeAccount[]
}

export type SourceRowView = {
  sourceId: string
  name: string
  amountMinor: number
  lastReceivedOn: string | null
  note: string | null
  onlyVoided: boolean
  /** "₹50,000 every month" for each recurring rule linked to the source; empty: one-off. */
  repeats: string[]
  /** Where this year's income went: an account label, "Multiple accounts", or null. */
  linkedLabel: string | null
  /** Its chart colour (0–5), "other" when grouped into Other, null when it has no bar. */
  color: number | "other" | null
}

export type ChartBarView = ChartGroup & Bar

export type PeriodView = {
  key: IncomePeriodKey
  tabLabel: string
  /** The period in words: "November 2026", "January – December 2026", "All recorded income". */
  rangeLabel: string
  totalMinor: number
  rows: SourceRowView[]
  bars: ChartBarView[]
  zeroBp: number
}

export type IncomePageView = {
  accounts: AccountsView
  /** Month and year always; All time only when it was asked for (?period=all). */
  periods: { month: PeriodView; year: PeriodView; all?: PeriodView }
}

const TYPE_LABELS = { savings: "Savings", current: "Current" } as const

export function accountTypeLabel(account: Pick<IncomeAccount, "kind" | "bankType">): string {
  if (account.kind === "bank") return account.bankType ? TYPE_LABELS[account.bankType] : "Bank"
  return account.kind === "cash" ? "Cash" : "Other"
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

export function buildIncomePageView(
  data: Pick<IncomePageData, "currency" | "today" | "accounts" | "sources" | "entries">,
  rules: readonly SourceRateRule[],
  { allTime = false }: { allTime?: boolean } = {},
): IncomePageView {
  const { currency, today, accounts, sources, entries } = data

  // Accounts: active only (archived are never charted); one rupee axis for those in the total.
  const holdings = summarizeHoldings(accounts, currency)
  const scale = horizontalBarScale(holdings.rows.filter((r) => r.inTotal).map((r) => r.balanceMinor))
  let next = 0
  const accountRows: AccountRowView[] = holdings.rows.map((r) => ({
    account: r.account,
    balanceMinor: r.balanceMinor,
    inTotal: r.inTotal,
    typeLabel: accountTypeLabel(r.account),
    bar: r.inTotal ? scale.bars[next++]! : null,
  }))
  const cashUpdatedAt =
    holdings.rows
      .filter((r) => r.account.kind === "cash")
      .map((r) => r.account.lastActivityAt)
      .sort()
      .at(-1) ?? null

  // Income: rates come only from recurring rules; the linked account from this year's entries.
  const month = monthRange(today)
  const year = yearRange(today)
  const rates = sourceRates(rules, today)
  const labelOf = (id: string) => accounts.find((a) => a.id === id)?.label ?? "Account"
  const linked = new Map(
    incomeBySource(entries, sources, { month, year }, currency).map((r) => [
      r.source.id,
      r.linked.kind === "multiple" ? "Multiple accounts" : r.linked.kind === "account" ? labelOf(r.linked.accountId) : null,
    ]),
  )

  const period = (key: IncomePeriodKey, tabLabel: string, rangeLabel: string, range: typeof month | null): PeriodView => {
    const { rows, totalMinor } = incomeForPeriod(entries, sources, range, currency)
    const groups = topGroupsWithOther(rows)
    const named = new Map(groups.filter((g) => g.colorIndex !== null).map((g) => [g.key, g.colorIndex!]))
    const barScale = horizontalBarScale(groups.map((g) => g.amountMinor))
    return {
      key,
      tabLabel,
      rangeLabel,
      totalMinor,
      zeroBp: barScale.zeroBp,
      bars: groups.map((g, i) => ({ ...g, ...barScale.bars[i]! })),
      rows: rows.map((r) => ({
        sourceId: r.source.id,
        name: r.source.name,
        amountMinor: r.amountMinor,
        lastReceivedOn: r.lastReceivedOn,
        note: r.note,
        onlyVoided: r.onlyVoided,
        repeats: (rates.get(r.source.id) ?? []).map((rate) => `${formatMoney(rate.amountMinor, { currency: rate.currency })} ${RATE_WORDS[rate.frequency]}`),
        linkedLabel:
          linked.get(r.source.id) ?? (r.source.defaultAccountId && accounts.some((a) => a.id === r.source.defaultAccountId) ? labelOf(r.source.defaultAccountId) : null),
        color: named.get(r.source.id) ?? (r.amountMinor > 0 ? "other" : null),
      })),
    }
  }

  const y = today.slice(0, 4)
  return {
    accounts: {
      rows: accountRows,
      zeroBp: scale.zeroBp,
      totalAvailableMinor: holdings.totalAvailableMinor,
      moneyInBanksMinor: holdings.moneyInBanksMinor,
      cashInHandMinor: holdings.cashInHandMinor,
      bankCount: holdings.bankCount,
      cashUpdatedAt,
      archived: holdings.archived,
    },
    periods: {
      month: period("month", "This month", `${MONTHS[Number(today.slice(5, 7)) - 1]} ${y}`, month),
      // The same calendar year as the old "Income this year" card.
      year: period("year", "This year", `January – December ${y}`, year),
      ...(allTime ? { all: period("all", "All time", "All recorded income", null) } : {}),
    },
  }
}
