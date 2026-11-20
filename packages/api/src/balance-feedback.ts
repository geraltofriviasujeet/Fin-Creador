import {
  type BalanceAfter,
  type BalanceChange,
  type BalanceEffectEntry,
  accountBalance,
  balanceChanges,
  isMoneyAccountKind,
  touchedAccounts,
} from "@fin-creador/domain"
import type { UserClient } from "./income/client"
import { accountLabel } from "./income/load"

// Balance feedback after a save (web and mobile): read once, after the write is confirmed,
// the balances of the accounts the entry touched, and work out "before" from the entry's own
// effect (packages/domain balance-change.ts). Money accounts only (bank, cash, other): a card
// or loan balance is what is owed, shown on its own page. Any failed read gives undefined, and
// the client then shows a plain "Saved".

/** The columns of a transactions row the effect needs (what the write functions return). */
export type EntryRow = {
  type: string
  amount_minor: number
  occurred_on: string
  account_id: string
  counter_account_id: string | null
}

const ENTRY_TYPES = ["income", "expense", "transfer", "refund"] as const
export const ENTRY_ROW_COLUMNS = "type, amount_minor, occurred_on, account_id, counter_account_id"

export function toEffectEntry(row: EntryRow): BalanceEffectEntry | null {
  const type = ENTRY_TYPES.find((t) => t === row.type)
  if (!type) return null
  return { type, amountMinor: row.amount_minor, occurredOn: row.occurred_on, accountId: row.account_id, counterAccountId: row.counter_account_id }
}

export async function readBalanceChanges(
  supabase: UserClient,
  addedRows: readonly EntryRow[],
  removedRows: readonly EntryRow[] = [],
): Promise<BalanceChange[] | undefined> {
  try {
    const added = addedRows.map(toEffectEntry)
    const removed = removedRows.map(toEffectEntry)
    if (added.some((e) => !e) || removed.some((e) => !e)) return undefined
    const ids = touchedAccounts([...(added as BalanceEffectEntry[]), ...(removed as BalanceEffectEntry[])])
    if (ids.length === 0) return undefined

    const [accountsRes, balancesRes] = await Promise.all([
      supabase.from("accounts").select("id, kind, name, last4, currency, opening_balance_minor, opening_balance_date").in("id", ids),
      supabase.from("account_balances").select("account_id, inflow_minor, outflow_minor").in("account_id", ids),
    ])
    if (accountsRes.error || balancesRes.error) return undefined

    const activity = new Map(balancesRes.data.map((b) => [b.account_id, b]))
    const after: BalanceAfter[] = []
    for (const id of ids) {
      const a = accountsRes.data.find((row) => row.id === id)
      if (!a || !isMoneyAccountKind(a.kind)) continue
      const b = activity.get(id)
      after.push({
        accountId: id,
        name: a.name,
        label: accountLabel(a),
        currency: a.currency,
        openingBalanceDate: a.opening_balance_date,
        afterMinor: accountBalance({
          id,
          kind: a.kind,
          bankType: null,
          currency: a.currency,
          openingBalanceMinor: a.opening_balance_minor,
          openingBalanceDate: a.opening_balance_date,
          archived: false,
          inflowMinor: b?.inflow_minor ?? 0,
          outflowMinor: b?.outflow_minor ?? 0,
        }),
      })
    }
    return balanceChanges(after, added as BalanceEffectEntry[], removed as BalanceEffectEntry[])
  } catch {
    return undefined
  }
}
