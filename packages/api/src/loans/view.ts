import {
  type DueKind,
  type DueStatus,
  type IsoDate,
  type LoanProgress,
  type LoanRateKind,
  type LoanStartMode,
  type LoanType,
  type MoratoriumInterest,
  type PaymentSplit,
  type Reminder,
  LOAN_TYPE_LABELS,
  addMinor,
  defaultPaymentSplit,
  dueReminders,
  loanProgress,
  loanSchedule,
  monthRange,
  outstandingFromBalance,
  shortfallMinor,
} from "@fin-creador/domain"
import { type PayingAccount, shortfallMessage } from "@fin-creador/schemas"

// The Loans & Liabilities page, the bell and the Overview "Due soon" card (Sprint 8a), built
// from the loaded rows with the shared domain rules. Pure, so web and mobile show the same
// figures. Nothing here posts money: payments go through the writers.

export type LoanRecord = {
  id: string
  accountId: string
  loanType: LoanType
  typeOther: string | null
  lender: string
  nickname: string | null
  currency: string
  sanctionedMinor: number
  disbursedMinor: number
  rateBps: number
  rateKind: LoanRateKind
  tenureMonths: number
  startMode: LoanStartMode
  openingOutstandingMinor: number
  instalmentMonths: number
  firstDueDate: IsoDate
  moratoriumMonths: number
  moratoriumInterest: MoratoriumInterest | null
  capitalisedMinor: number
  emiEstimateMinor: number
  emiMinor: number
  trackingStartedOn: IsoDate
  archivedAt: string | null
  createdAt: string
  /** The liability account's balance (0 or negative). */
  balanceMinor: number
}

export type DueRecord = {
  id: string
  kind: DueKind
  loanId: string
  seq: number
  dueDate: IsoDate
  amountDueMinor: number
  status: DueStatus
  plannedOn: IsoDate | null
  plannedAccountId: string | null
}

export type PaymentRecord = {
  id: string
  dueItemId: string
  accountId: string
  paidOn: IsoDate
  principalMinor: number
  interestMinor: number
  feesMinor: number
  capitalisedMinor: number
}

export type LoansData = {
  today: IsoDate
  currency: string
  loans: LoanRecord[]
  dueItems: DueRecord[]
  /** Active (not voided) payments. */
  payments: PaymentRecord[]
  /** Active bank, cash and other accounts with balances (names only, never digits). */
  accounts: PayingAccount[]
}

export type DueItem = DueRecord & {
  loanName: string
  /** "EMI 3", "This month's EMI", "Interest, month 2". */
  label: string
  payment: PaymentRecord | null
  /** The loan is archived: no reminders, nothing to pay. */
  sourceArchived: boolean
  /** Pending, but the loan is already cleared (a higher EMI finished it early). */
  notNeeded: boolean
  /** Pending: the split offered when paying, from what is owed now. */
  split: PaymentSplit | null
  /** Schedule figures: the payment's parts when paid, the projection when pending. */
  principalMinor: number | null
  interestMinor: number | null
  /** What the row shows as its amount. */
  amountMinor: number
  plannedAccountName: string | null
}

/** Paid: nothing due this month. Due: the next EMI is this month. Not due yet: nothing has fallen due. */
export type LoanBadge = "paid" | "due" | "overdue" | "not_due_yet" | "closed"

export type LoanItem = {
  loan: LoanRecord
  name: string
  typeLabel: string
  /** Owed now (the liability account). */
  outstandingMinor: number
  /** Moratorium interest that the first EMI paid will add to the loan (0 once added). */
  pendingCapitalisedMinor: number
  progress: LoanProgress
  next: DueItem | null
  badge: LoanBadge
  /** The schedule: every instalment, by due date. */
  items: DueItem[]
  hasPayments: boolean
  /** The warning shown ahead of time on the EMI card. */
  nextShortfall: string | null
}

export type LoansView = {
  today: IsoDate
  currency: string
  loans: LoanItem[]
  archived: LoanItem[]
  dueSoon: Reminder<DueItem>[]
  accounts: PayingAccount[]
  totalOutstandingMinor: number
}

export const LOAN_BADGE_LABEL: Record<LoanBadge, string> = {
  paid: "Paid",
  due: "Due",
  overdue: "Overdue",
  not_due_yet: "Not due yet",
  closed: "Closed",
}

/** Nickname, else the lender. Never a number. */
export const loanName = (l: Pick<LoanRecord, "nickname" | "lender">) => l.nickname ?? l.lender

export const loanTypeLabel = (l: Pick<LoanRecord, "loanType" | "typeOther">) => (l.loanType === "other" && l.typeOther ? l.typeOther : LOAN_TYPE_LABELS[l.loanType])

function dueLabel(d: Pick<DueRecord, "kind" | "seq">): string {
  if (d.kind === "loan_interest") return `Interest, month ${d.seq}`
  return d.seq === 0 ? "This month's EMI" : `EMI ${d.seq}`
}

const byDue = (a: DueRecord, b: DueRecord) =>
  a.dueDate.localeCompare(b.dueDate) || (a.kind === b.kind ? 0 : a.kind === "loan_interest" ? -1 : 1) || a.seq - b.seq || a.id.localeCompare(b.id)

function buildLoan(loan: LoanRecord, items: DueRecord[], payments: Map<string, PaymentRecord>, accounts: readonly PayingAccount[], today: IsoDate): LoanItem {
  const name = loanName(loan)
  const archived = loan.archivedAt !== null
  const outstandingMinor = outstandingFromBalance(loan.balanceMinor)
  const sorted = [...items].sort(byDue)
  const capitalisedPosted = sorted.some((d) => (payments.get(d.id)?.capitalisedMinor ?? 0) > 0)
  const pendingCapitalisedMinor = loan.moratoriumInterest === "capitalise" && loan.capitalisedMinor > 0 && !capitalisedPosted ? loan.capitalisedMinor : 0
  const owedForEmi = addMinor(outstandingMinor, pendingCapitalisedMinor)
  const cleared = owedForEmi === 0

  // Projection of pending EMIs from what is owed now, with the EMI in use (matched by order).
  const pendingEmis = sorted.filter((d) => d.kind === "loan_emi" && d.status === "pending")
  let projection: ReturnType<typeof loanSchedule> = []
  if (!cleared && pendingEmis.length > 0) {
    try {
      projection = loanSchedule({ principalMinor: owedForEmi, rateBps: loan.rateBps, emiMinor: loan.emiMinor, months: pendingEmis.length, firstDueDate: pendingEmis[0]!.dueDate })
    } catch {
      projection = []
    }
  }
  const lastPendingEmi = pendingEmis.at(-1)?.id
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))

  let emiIndex = 0
  const dueItems: DueItem[] = sorted.map((d) => {
    const payment = payments.get(d.id) ?? null
    const base = { ...d, loanName: name, label: dueLabel(d), payment, sourceArchived: archived, plannedAccountName: d.plannedAccountId ? (accountName.get(d.plannedAccountId) ?? null) : null }
    if (d.status === "paid" && payment) {
      return {
        ...base,
        notNeeded: false,
        split: null,
        principalMinor: payment.principalMinor,
        interestMinor: payment.interestMinor,
        amountMinor: addMinor(payment.principalMinor, payment.interestMinor, payment.feesMinor),
      }
    }
    if (d.status !== "pending") return { ...base, notNeeded: false, split: null, principalMinor: null, interestMinor: null, amountMinor: d.amountDueMinor }
    if (d.kind === "loan_interest") {
      const split = defaultPaymentSplit({ kind: "interest_only", amountDueMinor: d.amountDueMinor, outstandingMinor, rateBps: loan.rateBps, isLast: false })
      return { ...base, notNeeded: false, split, principalMinor: 0, interestMinor: d.amountDueMinor, amountMinor: d.amountDueMinor }
    }
    const row = projection[emiIndex]
    emiIndex += 1
    if (cleared || (projection.length > 0 && !row)) return { ...base, notNeeded: true, split: null, principalMinor: null, interestMinor: null, amountMinor: 0 }
    const split = defaultPaymentSplit({ kind: "emi", amountDueMinor: d.amountDueMinor, outstandingMinor: owedForEmi, rateBps: loan.rateBps, isLast: d.id === lastPendingEmi })
    return {
      ...base,
      notNeeded: false,
      split,
      principalMinor: row?.principalMinor ?? null,
      interestMinor: row?.interestMinor ?? null,
      amountMinor: row?.amountMinor ?? d.amountDueMinor,
    }
  })

  const payable = dueItems.filter((d) => d.status === "pending" && !d.notNeeded)
  const next = payable[0] ?? null
  const month = monthRange(today)
  const badge: LoanBadge = cleared
    ? "closed"
    : next && next.dueDate < today
      ? "overdue"
      : next && next.dueDate <= month.end
        ? "due"
        : dueItems.some((d) => d.dueDate <= today)
          ? "paid"
          : "not_due_yet"

  return {
    loan,
    name,
    typeLabel: loanTypeLabel(loan),
    outstandingMinor,
    pendingCapitalisedMinor,
    progress: loanProgress(outstandingMinor, addMinor(loan.openingOutstandingMinor, loan.capitalisedMinor)),
    next,
    badge,
    items: dueItems,
    hasPayments: dueItems.some((d) => d.payment !== null),
    nextShortfall: archived || !next?.split ? null : shortfallFor(next, next.split.totalMinor, accounts, loan.currency),
  }
}

/**
 * The warning on the EMI card: against the planned account when there is one; otherwise only
 * when no account can cover the EMI (named after the account with the most money).
 */
function shortfallFor(item: DueItem, totalMinor: number, accounts: readonly PayingAccount[], currency: string): string | null {
  const eligible = accounts.filter((a) => a.currency === currency)
  const planned = item.plannedAccountId ? eligible.find((a) => a.id === item.plannedAccountId) : undefined
  const account = planned ?? eligible.reduce<PayingAccount | undefined>((best, a) => (!best || a.balanceMinor > best.balanceMinor ? a : best), undefined)
  if (!account) return null
  const short = shortfallMinor(account.balanceMinor, totalMinor)
  return short > 0 ? shortfallMessage(short, account.name, currency) : null
}

export function buildLoansView(data: LoansData): LoansView {
  const payments = new Map(data.payments.map((p) => [p.dueItemId, p]))
  const itemsByLoan = new Map<string, DueRecord[]>()
  for (const d of data.dueItems) itemsByLoan.set(d.loanId, [...(itemsByLoan.get(d.loanId) ?? []), d])
  const all = data.loans.map((l) => buildLoan(l, itemsByLoan.get(l.id) ?? [], payments, data.accounts, data.today))
  const order = (a: LoanItem, b: LoanItem) =>
    Number(a.badge === "closed") - Number(b.badge === "closed") ||
    (a.next?.dueDate ?? "9999-12-31").localeCompare(b.next?.dueDate ?? "9999-12-31") ||
    a.loan.createdAt.localeCompare(b.loan.createdAt)
  const loans = all.filter((l) => l.loan.archivedAt === null).sort(order)
  const archived = all.filter((l) => l.loan.archivedAt !== null).sort((a, b) => (b.loan.archivedAt ?? "").localeCompare(a.loan.archivedAt ?? ""))
  const reminders = dueReminders(
    loans.flatMap((l) => l.items.filter((d) => !d.notNeeded)),
    data.today,
  )
  return {
    today: data.today,
    currency: data.currency,
    loans,
    archived,
    dueSoon: reminders,
    accounts: data.accounts,
    totalOutstandingMinor: addMinor(...loans.filter((l) => l.loan.currency === data.currency).map((l) => l.outstandingMinor)),
  }
}

/** "Overdue by 3 days", "Due today", "Planned for tomorrow". */
export function reminderText(r: Pick<Reminder, "reason" | "daysOverdue">): string {
  switch (r.reason) {
    case "overdue":
      return r.daysOverdue === 1 ? "Overdue by 1 day" : `Overdue by ${r.daysOverdue} days`
    case "due_today":
      return "Due today"
    case "due_tomorrow":
      return "Due tomorrow"
    case "planned_today":
      return "You planned to pay today"
    case "planned_tomorrow":
      return "You planned to pay tomorrow"
  }
}
