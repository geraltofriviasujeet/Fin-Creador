import {
  type Frequency,
  type IsoDate,
  type RecurringCosts,
  addDays,
  latestOccurrenceOnOrBefore,
  recurringCosts,
  recurringStatus,
  scheduleText,
} from "@fin-creador/domain"
import type { PaymentModeValue } from "@fin-creador/schemas"
import type { EntryType, LedgerAccount, LedgerCategory, LedgerItem } from "../transactions/types"

// What the Recurring page and the Upcoming card show, computed from the rules and their
// progress with packages/domain (decisions 2026-10-23 and 2026-10-24). Shared by web and mobile.

/** Coming-up items are listed this many days ahead (owner, 2026-10-23). */
export const UPCOMING_DAYS = 30

export type RecurringRule = {
  id: string
  type: EntryType
  amountMinor: number
  currency: string
  accountId: string
  counterAccountId: string | null
  categoryId: string | null
  paymentMode: PaymentModeValue | null
  note: string | null
  frequency: Frequency
  startDate: IsoDate
  endDate: IsoDate | null
  archived: boolean
}

/** Latest posted (non-voided) and latest skipped occurrence (recurring_rule_progress). */
export type RecurringProgress = { lastPostedOn: IsoDate | null; lastSkippedOn: IsoDate | null }

export type RecurringItem = {
  rule: RecurringRule
  kind: "due" | "needs_attention" | "upcoming" | "ended" | "archived"
  /** Due or upcoming occurrence; for "needs attention" the one waiting; the end date once ended. */
  date: IsoDate | null
  schedule: string
  /** What confirming posts, as a ledger entry (for the shared text helpers). */
  entry: LedgerItem
  /** Why it can't post (an archived account or category). */
  attention: string | null
  /** The skip that Undo would undo (only while it is the latest handled occurrence). */
  undoableSkip: IsoDate | null
  lastPostedOn: IsoDate | null
}

export type RecurringGroup = "subscription" | "membership" | "other"

export type RecurringView = {
  due: RecurringItem[]
  attention: RecurringItem[]
  soon: RecurringItem[]
  ended: RecurringItem[]
  archived: RecurringItem[]
  /** Active rules (not ended, not archived), by the category's stable key. */
  groups: Record<RecurringGroup, RecurringItem[]>
  /**
   * Cost tiles per currency: the profile currency always (zero tiles too); other currencies
   * only when they have an active recurring expense. `showTile` hides their empty tiles.
   */
  costs: RecurringCosts[]
}

export function ruleEntry(rule: RecurringRule, date: IsoDate | null): LedgerItem {
  return {
    id: `${rule.id}:${date ?? ""}`,
    type: rule.type,
    amountMinor: rule.amountMinor,
    currency: rule.currency,
    occurredOn: date ?? rule.startDate,
    accountId: rule.accountId,
    counterAccountId: rule.counterAccountId,
    categoryId: rule.categoryId,
    voided: false,
    replacesId: null,
    note: rule.note,
    paymentMode: rule.paymentMode,
    createdAt: "",
    voidReason: null,
  }
}

/** Why a rule can't post: an archived account or category (decision L), or null. */
export function blockedBy(rule: RecurringRule, accounts: ReadonlyMap<string, LedgerAccount>, categories: ReadonlyMap<string, LedgerCategory>): string | null {
  const archived = [rule.accountId, rule.counterAccountId].map((id) => (id ? accounts.get(id) : undefined)).find((a) => a?.archived)
  if (archived) return `${archived.label} is archived. Choose another account to keep this recurring item posting.`
  const c = rule.categoryId ? categories.get(rule.categoryId) : undefined
  if (c?.archived) return `${c.name} is archived. Choose another ${rule.type === "income" ? "source" : "category"} to keep this recurring item posting.`
  return null
}

export function buildRecurringView({
  rules,
  progress,
  accounts,
  categories,
  today,
  currency,
}: {
  rules: readonly RecurringRule[]
  progress: ReadonlyMap<string, RecurringProgress>
  accounts: readonly LedgerAccount[]
  categories: readonly LedgerCategory[]
  today: IsoDate
  currency: string
}): RecurringView {
  const accountMap = new Map(accounts.map((a) => [a.id, a]))
  const categoryMap = new Map(categories.map((c) => [c.id, c]))

  const items = rules.map((rule): RecurringItem => {
    const p = progress.get(rule.id) ?? { lastPostedOn: null, lastSkippedOn: null }
    // Every handled occurrence is on or before the latest one, so the latest is handled
    // exactly when it is the latest posted or the latest skipped date.
    const handled = new Set([p.lastPostedOn, p.lastSkippedOn].filter((d): d is IsoDate => d !== null))
    const attention = blockedBy(rule, accountMap, categoryMap)
    const status = recurringStatus({ ...rule, blocked: attention !== null }, today, handled)
    const date =
      status.kind === "ended" ? (rule.endDate ?? latestOccurrenceOnOrBefore(rule, today)) : status.kind === "archived" ? null : status.date
    return {
      rule,
      kind: status.kind,
      date,
      schedule: scheduleText(rule),
      entry: ruleEntry(rule, date),
      attention: status.kind === "needs_attention" ? attention : null,
      undoableSkip: p.lastSkippedOn && p.lastSkippedOn > (p.lastPostedOn ?? "") ? p.lastSkippedOn : null,
      lastPostedOn: p.lastPostedOn,
    }
  })

  const byDate = (a: RecurringItem, b: RecurringItem) => (a.date ?? "").localeCompare(b.date ?? "")
  const horizon = addDays(today, UPCOMING_DAYS)
  const active = items.filter((i) => i.kind !== "ended" && i.kind !== "archived")
  const groupOf = (i: RecurringItem): RecurringGroup => (i.rule.categoryId ? categoryMap.get(i.rule.categoryId)?.key : null) ?? "other"

  const costs = recurringCosts(
    active.map((i) => ({ type: i.rule.type, amountMinor: i.rule.amountMinor, currency: i.rule.currency, frequency: i.rule.frequency, group: groupOf(i), active: true }))
  )
  if (!costs.some((c) => c.currency === currency)) {
    const zero = { yearlyMinor: 0, monthlyMinor: 0, count: 0 }
    costs.unshift({ currency, subscriptions: zero, memberships: zero, total: zero })
  }
  costs.sort((a, b) => (a.currency === currency ? -1 : b.currency === currency ? 1 : a.currency.localeCompare(b.currency)))

  return {
    due: items.filter((i) => i.kind === "due").sort(byDate),
    attention: items.filter((i) => i.kind === "needs_attention").sort(byDate),
    soon: items.filter((i) => i.kind === "upcoming" && i.date !== null && i.date <= horizon).sort(byDate),
    ended: items.filter((i) => i.kind === "ended").sort(byDate),
    archived: items.filter((i) => i.kind === "archived"),
    groups: {
      subscription: active.filter((i) => groupOf(i) === "subscription"),
      membership: active.filter((i) => groupOf(i) === "membership"),
      other: active.filter((i) => groupOf(i) === "other"),
    },
    costs,
  }
}

/** Cost tiles: always for the profile currency; for other currencies only when not empty. */
export const showCostTile = (costs: RecurringCosts, tile: "subscriptions" | "memberships" | "total", profileCurrency: string) =>
  costs.currency === profileCurrency || costs[tile].count > 0
