import { type IsoDate, accountBalance, addMinor, cardUtilisation, countsTowardBalance, formatMoney, outstandingFromBalance } from "@fin-creador/domain"
import type { EntryType, LedgerAccount, LedgerItem } from "./types"

// What a draft entry would do to its account balances, for the Add / Edit forms on web and
// mobile. Informational only: the database computes the real balances.

/** Current balance per account, leaving out the entry being edited (so the preview shows its replacement). */
export function balancesWithout(accounts: readonly LedgerAccount[], editing: LedgerItem | null): Map<string, number> {
  const balances = new Map(accounts.map((a) => [a.id, accountBalance(a)]))
  if (!editing || editing.voided) return balances
  const undo = (accountId: string | null, delta: number) => {
    const a = accounts.find((x) => x.id === accountId)
    if (a && countsTowardBalance(editing.occurredOn, a.openingBalanceDate)) balances.set(a.id, addMinor(balances.get(a.id) ?? 0, delta))
  }
  undo(editing.accountId, editing.type === "income" ? -editing.amountMinor : editing.amountMinor)
  if (editing.type === "transfer") undo(editing.counterAccountId, -editing.amountMinor)
  return balances
}

export type BalanceMove = { account: LedgerAccount; before: number; after: number }

export type DraftPreview = {
  /** Balance changes, for accounts whose balance the entry counts toward. */
  moves: BalanceMove[]
  /** A cash or other account that would go below zero (banks may go negative). */
  goesNegative: BalanceMove | null
  /** Accounts the entry is dated before the opening balance of (their balance doesn't change). */
  beforeOpening: LedgerAccount[]
}

export function previewDraft({
  type,
  amountMinor,
  occurredOn,
  account,
  counter,
  balances,
}: {
  type: EntryType
  amountMinor: number | null
  occurredOn: IsoDate
  account: LedgerAccount | undefined
  counter: LedgerAccount | undefined
  balances: Map<string, number>
}): DraftPreview {
  const sides = [
    { a: account, delta: amountMinor === null ? 0 : type === "income" ? amountMinor : -amountMinor },
    { a: type === "transfer" ? counter : undefined, delta: amountMinor ?? 0 },
  ]
  const moves: BalanceMove[] = []
  const beforeOpening: LedgerAccount[] = []
  for (const { a, delta } of sides) {
    if (!a || !occurredOn) continue
    if (!countsTowardBalance(occurredOn, a.openingBalanceDate)) {
      beforeOpening.push(a)
      continue
    }
    if (amountMinor === null) continue
    const before = balances.get(a.id) ?? 0
    moves.push({ account: a, before, after: addMinor(before, delta) })
  }
  // A card's balance is minus what is owed: never "below zero" (cardLimitWarning instead).
  return { moves, goesNegative: moves.find((m) => m.after < 0 && m.account.kind !== "bank" && m.account.kind !== "card") ?? null, beforeOpening }
}

/** A purchase that takes a card to 80% or more of its limit, or over it. */
export function cardLimitWarning(move: BalanceMove | undefined): string | null {
  const limit = move?.account.limitMinor
  if (!move || move.account.kind !== "card" || !limit) return null
  const { bps, level } = cardUtilisation(outstandingFromBalance(move.after), limit)
  const name = move.account.label.replace(/ \(card\)$/, "")
  if (level === "over") return `This takes ${name} over its limit of ${formatMoney(limit, { currency: move.account.currency })}.`
  if (level === "high") return `This takes ${name} to ${Math.floor(bps / 100)}% of its limit.`
  return null
}
