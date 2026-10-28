import { type DueStatus, type IsoDate, type StatutoryState, type StatutoryType, addMinor, formatMoney, statutoryDueState } from "@fin-creador/domain"
import { type PayingAccount, STATUTORY_TYPE_LABEL, type VehicleKind, statutoryDueName } from "@fin-creador/schemas"

// The "Statutory & legal liabilities" box (Sprint 8d): income tax payable, fines and other
// statutory dues, what is paid and left, and their payments. Nothing is posted until paid;
// net worth (8e) subtracts what is still due. Names only: never challan or vehicle numbers.

export type StatutoryDueRecord = {
  id: string
  dueType: StatutoryType
  description: string | null
  vehicleKind: VehicleKind | null
  issuedState: string | null
  issuedCity: string | null
  currency: string
  amountMinor: number
  dueDate: IsoDate
  /** The account it will be paid from (null if none, or that account was deleted). */
  payFromAccountId: string | null
  archivedAt: string | null
  createdAt: string
}

export type StatutoryItemRecord = {
  id: string
  statutoryDueId: string
  dueDate: IsoDate
  amountDueMinor: number
  status: DueStatus
  plannedOn: IsoDate | null
  plannedAccountId: string | null
  payFromAccountId: string | null
}

export type StatutoryPaymentRecord = {
  id: string
  dueItemId: string
  accountId: string
  paidOn: IsoDate
  principalMinor: number
  interestMinor: number
}

export type StatutoryData = {
  dues: StatutoryDueRecord[]
  items: StatutoryItemRecord[]
  /** Active (not voided) payments. */
  payments: StatutoryPaymentRecord[]
  /** Items with any payment, voided ones included (the database refuses to delete those). */
  everPaidItemIds: string[]
  /** Names of every account a payment or plan touched (archived ones included). */
  accountNames: Record<string, string>
}

export type StatutoryDueItem = StatutoryItemRecord & {
  /** For reminders: what is still due. */
  leftMinor: number
  plannedAccountName: string | null
  payFromAccountName: string | null
  sourceArchived: boolean
}

export type StatutoryBadge = "due" | "overdue" | "part_paid" | "paid"

export type StatutoryPaymentLine = StatutoryPaymentRecord & { accountName: string }

export type StatutoryItem = {
  due: StatutoryDueRecord
  name: string
  typeLabel: string
  item: StatutoryDueItem
  paidMinor: number
  leftMinor: number
  state: StatutoryState
  badge: StatutoryBadge
  payments: StatutoryPaymentLine[]
  hasHistory: boolean
}

export type StatutoryView = {
  dues: StatutoryItem[]
  archived: StatutoryItem[]
  /** What is still due on active dues, in the profile currency. */
  totalDueMinor: number
}

const nameOf = (names: Record<string, string>, accounts: readonly PayingAccount[], id: string | null) =>
  id ? (accounts.find((a) => a.id === id)?.name ?? names[id] ?? "an archived account") : null

export function buildStatutoryView(data: StatutoryData, ctx: { today: IsoDate; currency: string; accounts: readonly PayingAccount[] }): StatutoryView {
  const everPaid = new Set(data.everPaidItemIds)
  const all: StatutoryItem[] = data.dues.flatMap((due) => {
    const record = data.items.find((i) => i.statutoryDueId === due.id)
    if (!record) return []
    const payments = data.payments
      .filter((p) => p.dueItemId === record.id)
      .map((p) => ({ ...p, accountName: nameOf(data.accountNames, ctx.accounts, p.accountId) ?? "" }))
      .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.id.localeCompare(a.id))
    const paidMinor = addMinor(...payments.map((p) => p.principalMinor))
    const { state, leftMinor } = statutoryDueState(record.amountDueMinor, Math.min(paidMinor, record.amountDueMinor))
    const badge: StatutoryBadge = state === "paid" ? "paid" : record.dueDate < ctx.today ? "overdue" : state === "part_paid" ? "part_paid" : "due"
    return [
      {
        due,
        name: statutoryDueName(due),
        typeLabel: STATUTORY_TYPE_LABEL[due.dueType],
        item: {
          ...record,
          leftMinor,
          plannedAccountName: nameOf(data.accountNames, ctx.accounts, record.plannedAccountId),
          payFromAccountName: nameOf(data.accountNames, ctx.accounts, record.payFromAccountId),
          sourceArchived: due.archivedAt !== null,
        },
        paidMinor,
        leftMinor,
        state,
        badge,
        payments,
        hasHistory: payments.length > 0 || everPaid.has(record.id),
      },
    ]
  })
  const order = (a: StatutoryItem, b: StatutoryItem) => a.due.dueDate.localeCompare(b.due.dueDate) || a.due.createdAt.localeCompare(b.due.createdAt)
  const dues = all.filter((d) => d.due.archivedAt === null).sort(order)
  return {
    dues,
    archived: all.filter((d) => d.due.archivedAt !== null).sort((a, b) => (b.due.archivedAt ?? "").localeCompare(a.due.archivedAt ?? "")),
    totalDueMinor: addMinor(...dues.filter((d) => d.due.currency === ctx.currency).map((d) => d.leftMinor)),
  }
}

export const STATUTORY_BADGE_LABEL: Record<Exclude<StatutoryBadge, "part_paid">, string> = { due: "Due", overdue: "Overdue", paid: "Paid" }

/** "Part-paid, ₹2,000 left"; overdue with something paid says what is left too. */
export function statutoryBadgeText(item: Pick<StatutoryItem, "badge" | "leftMinor" | "paidMinor" | "due">): string {
  const left = formatMoney(item.leftMinor, { currency: item.due.currency })
  if (item.badge === "part_paid") return `Part-paid, ${left} left`
  if (item.badge === "overdue" && item.paidMinor > 0) return `Overdue, ${left} left`
  return STATUTORY_BADGE_LABEL[item.badge]
}
