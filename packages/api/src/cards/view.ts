import {
  type CardBillState,
  type DueStatus,
  type IsoDate,
  type Reminder,
  type ReminderReason,
  type UtilisationLevel,
  REMINDER_ORDER,
  addMinor,
  cardBillState,
  cardUtilisation,
  dueReminders,
  formatMoney,
  outstandingFromBalance,
  payBillDefaultMinor,
  statementReminder,
} from "@fin-creador/domain"
import type { PayingAccount } from "@fin-creador/schemas"
import type { DueItem, LoanItem, PaymentRecord } from "../loans/view"

// The "Short-term & operational liabilities" box (Sprint 8b): credit cards, their bills and
// statements, card EMIs (loans) and informal borrowing, plus their reminders for Due soon and
// the bell. Built from loaded rows with the shared domain rules; pure and serialisable, so web
// and mobile show the same figures. Payments go through the writers.

export type CardRecord = {
  id: string
  accountId: string
  issuer: string
  nickname: string | null
  currency: string
  limitMinor: number
  statementDay: number
  dueDay: number
  openingOwedMinor: number
  trackingStartedOn: IsoDate
  archivedAt: string | null
  createdAt: string
  /** The card account's balance: minus what is owed (positive when in credit). */
  balanceMinor: number
  /** Any purchase on the card (voided ones count): it then can't be deleted. */
  hasEntries: boolean
}

export type StatementRecord = {
  id: string
  cardId: string
  statementDate: IsoDate
  dueDate: IsoDate
  totalMinor: number
  minimumMinor: number
  emiIncludedMinor: number
  owedAtStatementMinor: number | null
  differenceMinor: number
}

export type CardBillRecord = {
  /** The due item. */
  id: string
  statementId: string
  dueDate: IsoDate
  amountDueMinor: number
  minimumDueMinor: number | null
  status: DueStatus
  plannedOn: IsoDate | null
  plannedAccountId: string | null
  /** Transfers into the card dated on or after the statement (public.card_bill_paid). */
  paidMinor: number
}

export type BorrowingRecord = {
  id: string
  accountId: string
  lender: string
  currency: string
  borrowedMinor: number
  receivedOn: IsoDate | null
  /** The account the money went into (when it was received into one). */
  receiptAccountId: string | null
  archivedAt: string | null
  createdAt: string
  balanceMinor: number
}

export type BorrowingDueRecord = {
  id: string
  borrowingId: string
  dueDate: IsoDate
  amountDueMinor: number
  status: DueStatus
  plannedOn: IsoDate | null
  plannedAccountId: string | null
}

export type LiabilityPaymentRecord = {
  id: string
  liabilityAccountId: string
  accountId: string
  paidOn: IsoDate
  principalMinor: number
  interestMinor: number
}

export type ShortTermData = {
  cards: CardRecord[]
  statements: StatementRecord[]
  bills: CardBillRecord[]
  borrowings: BorrowingRecord[]
  borrowingDues: BorrowingDueRecord[]
  /** Active (not voided) card payments and repayments. */
  liabilityPayments: LiabilityPaymentRecord[]
  /** Names of every account a payment or receipt touched (archived ones included). */
  accountNames: Record<string, string>
  /** Active expense categories, for "record the difference as an expense". */
  expenseCategories: { id: string; name: string }[]
}

export type CardBill = CardBillRecord & {
  statement: StatementRecord
  state: CardBillState
  leftMinor: number
  /** Paid in full, or at least the minimum: no reminders. */
  covered: boolean
  /** The payment that closed it through Pay bill (a part-paid bill is closed). */
  payment: PaymentRecord | null
  /** Pay bill's default: the bill minus what is paid, at most what the card owes. */
  payDefaultMinor: number
  plannedAccountName: string | null
}

export type CardBadge = "no_bill" | "due" | "overdue" | "paid" | "minimum_paid" | "part_paid"

/** One line of a card's or borrowing's payment history. */
export type LiabilityPaymentLine = {
  id: string
  /** "bill": paid through Pay bill (a due payment); "free": any amount (a liability payment). */
  kind: "bill" | "free"
  paidOn: IsoDate
  principalMinor: number
  interestMinor: number
  accountId: string
  accountName: string
  billId: string | null
}

export type CardItem = {
  card: CardRecord
  name: string
  owedMinor: number
  /** Overpaid (the card is in credit), else 0. */
  creditMinor: number
  utilisation: { bps: number; level: UtilisationLevel }
  latestBill: CardBill | null
  /** The bill Pay card defaults to: pending, else null. */
  pendingBill: CardBill | null
  badge: CardBadge
  statements: (StatementRecord & { deletable: boolean })[]
  payments: LiabilityPaymentLine[]
  /** "Add your <card> statement": the statement date to add, or null. */
  statementToAdd: IsoDate | null
  /** EMIs of card EMI loans linked to this card, for "EMIs included". */
  linkedEmis: { dueDate: IsoDate; amountMinor: number }[]
  linkedLoanIds: string[]
  hasHistory: boolean
}

export type BorrowingDue = BorrowingDueRecord & { plannedAccountName: string | null }

export type BorrowingBadge = "repaid" | "due" | "overdue" | "owed"

export type BorrowingItem = {
  borrowing: BorrowingRecord
  name: string
  /** What is still owed (not the original amount). */
  owedMinor: number
  repaidMinor: number
  due: BorrowingDue | null
  badge: BorrowingBadge
  receiptAccountName: string | null
  payments: LiabilityPaymentLine[]
  hasRepayments: boolean
}

export type ShortTermView = {
  cards: CardItem[]
  archivedCards: CardItem[]
  borrowings: BorrowingItem[]
  archivedBorrowings: BorrowingItem[]
  /** Credit card EMI loans (from the loans): shown in this box, not in Long-term. */
  cardEmis: LoanItem[]
  /** Cards, card EMIs and borrowings owed now, in the profile currency. */
  totalOwedMinor: number
  expenseCategories: { id: string; name: string }[]
}

/** One reminder line for Due soon and the bell: a loan EMI, a card bill, a borrowing or a statement to add. */
export type ReminderEntry = {
  id: string
  source: "loan" | "card" | "borrowing"
  name: string
  label: string
  dueDate: IsoDate | null
  plannedOn: IsoDate | null
  plannedAccountName: string | null
  amountMinor: number | null
  currency: string
  reason: ReminderReason | "statement"
  daysOverdue: number
  /** Loans: the instalment to pay. */
  loanItem: DueItem | null
  cardId: string | null
  billId: string | null
  borrowingId: string | null
}

export const CARD_BADGE_LABEL: Record<Exclude<CardBadge, "part_paid">, string> = {
  no_bill: "No bill yet",
  due: "Due",
  overdue: "Overdue",
  paid: "Paid",
  minimum_paid: "Minimum paid",
}

/** The badge text: "Part-paid, ₹2,000 left" names what is left. */
export function cardBadgeText(item: Pick<CardItem, "badge" | "latestBill" | "card">): string {
  if (item.badge === "part_paid") return `Part-paid, ${formatMoney(item.latestBill?.leftMinor ?? 0, { currency: item.card.currency })} left`
  return CARD_BADGE_LABEL[item.badge]
}

export const BORROWING_BADGE_LABEL: Record<BorrowingBadge, string> = { repaid: "Repaid", due: "Due", overdue: "Overdue", owed: "Owed" }

/** Nickname, else the issuer. Never a number. */
export const cardName = (c: Pick<CardRecord, "nickname" | "issuer">) => c.nickname ?? c.issuer

const nameOf = (names: Record<string, string>, accounts: readonly PayingAccount[], id: string | null) =>
  id ? (accounts.find((a) => a.id === id)?.name ?? names[id] ?? "an archived account") : null

function buildCard(card: CardRecord, data: ShortTermData, ctx: Ctx): CardItem {
  const name = cardName(card)
  const archived = card.archivedAt !== null
  const owedMinor = outstandingFromBalance(card.balanceMinor)
  const statements = data.statements.filter((s) => s.cardId === card.id).sort((a, b) => b.statementDate.localeCompare(a.statementDate))
  const bills: CardBill[] = statements.flatMap((statement) => {
    const bill = data.bills.find((b) => b.statementId === statement.id)
    if (!bill) return []
    const payment = ctx.payments.get(bill.id) ?? null
    const s = cardBillState({ amountDueMinor: bill.amountDueMinor, minimumDueMinor: bill.minimumDueMinor, paidMinor: bill.paidMinor, closed: payment !== null })
    // Nothing owed on the card: the bill needs no more reminders either.
    const covered = s.covered || owedMinor === 0
    return [
      {
        ...bill,
        statement,
        state: s.state,
        leftMinor: s.leftMinor,
        covered,
        payment,
        payDefaultMinor: payBillDefaultMinor(bill.amountDueMinor, bill.paidMinor, owedMinor),
        plannedAccountName: nameOf(data.accountNames, ctx.accounts, bill.plannedAccountId),
      },
    ]
  })
  const latestBill = bills[0] ?? null
  const pendingBill = bills.find((b) => b.status === "pending") ?? null
  const badge: CardBadge = !latestBill
    ? "no_bill"
    : pendingBill && !pendingBill.covered
      ? pendingBill.dueDate < ctx.today
        ? "overdue"
        : "due"
      : latestBill.state === "paid" || owedMinor === 0
        ? "paid"
        : latestBill.state === "minimum_paid"
          ? "minimum_paid"
          : latestBill.state === "part_paid"
            ? "part_paid"
            : "paid"

  const billIds = new Set(bills.map((b) => b.id))
  const payments: LiabilityPaymentLine[] = [
    ...ctx.paymentList
      .filter((p) => billIds.has(p.dueItemId))
      .map((p) => ({
        id: p.id,
        kind: "bill" as const,
        paidOn: p.paidOn,
        principalMinor: p.principalMinor,
        interestMinor: 0,
        accountId: p.accountId,
        accountName: nameOf(data.accountNames, ctx.accounts, p.accountId) ?? "",
        billId: p.dueItemId,
      })),
    ...data.liabilityPayments.filter((p) => p.liabilityAccountId === card.accountId).map((p) => freeLine(p, data, ctx)),
  ].sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.id.localeCompare(a.id))

  const linkedLoans = ctx.loans.filter((l) => l.loan.cardId === card.id)
  const reminder = statementReminder({ statementDay: card.statementDay, trackingStartedOn: card.trackingStartedOn, archived }, statements.map((s) => s.statementDate), ctx.today)
  return {
    card,
    name,
    owedMinor,
    creditMinor: card.balanceMinor > 0 ? card.balanceMinor : 0,
    utilisation: cardUtilisation(owedMinor, card.limitMinor),
    latestBill,
    pendingBill: archived ? null : pendingBill,
    badge,
    statements: statements.map((s) => {
      const bill = bills.find((b) => b.statementId === s.id)
      return { ...s, deletable: !archived && !ctx.paymentList.some((p) => p.dueItemId === bill?.id) && !(bill && ctx.everPaidBillIds.has(bill.id)) }
    }),
    payments,
    statementToAdd: reminder?.statementDate ?? null,
    linkedEmis: linkedLoans.flatMap((l) => l.items.filter((d) => d.kind === "loan_emi").map((d) => ({ dueDate: d.dueDate, amountMinor: d.amountDueMinor }))),
    linkedLoanIds: linkedLoans.map((l) => l.loan.id),
    hasHistory: card.hasEntries || statements.length > 0 || payments.length > 0 || ctx.everPaidCardAccounts.has(card.accountId),
  }
}

function freeLine(p: LiabilityPaymentRecord, data: ShortTermData, ctx: Ctx): LiabilityPaymentLine {
  return {
    id: p.id,
    kind: "free",
    paidOn: p.paidOn,
    principalMinor: p.principalMinor,
    interestMinor: p.interestMinor,
    accountId: p.accountId,
    accountName: nameOf(data.accountNames, ctx.accounts, p.accountId) ?? "",
    billId: null,
  }
}

function buildBorrowing(b: BorrowingRecord, data: ShortTermData, ctx: Ctx): BorrowingItem {
  const owedMinor = outstandingFromBalance(b.balanceMinor)
  const dueRecord = data.borrowingDues.find((d) => d.borrowingId === b.id) ?? null
  const due = dueRecord ? { ...dueRecord, plannedAccountName: nameOf(data.accountNames, ctx.accounts, dueRecord.plannedAccountId) } : null
  const payments = data.liabilityPayments
    .filter((p) => p.liabilityAccountId === b.accountId)
    .map((p) => freeLine(p, data, ctx))
    .sort((x, y) => y.paidOn.localeCompare(x.paidOn) || y.id.localeCompare(x.id))
  const badge: BorrowingBadge = owedMinor === 0 ? "repaid" : !due ? "owed" : due.dueDate < ctx.today ? "overdue" : "due"
  return {
    borrowing: b,
    name: b.lender,
    owedMinor,
    repaidMinor: Math.max(addMinor(b.borrowedMinor, -owedMinor), 0),
    due,
    badge,
    receiptAccountName: nameOf(data.accountNames, ctx.accounts, b.receiptAccountId),
    payments,
    hasRepayments: payments.length > 0 || ctx.everPaidBorrowingAccounts.has(b.accountId),
  }
}

type Ctx = {
  today: IsoDate
  accounts: readonly PayingAccount[]
  loans: LoanItem[]
  payments: Map<string, PaymentRecord>
  paymentList: PaymentRecord[]
  /** History the database counts (voided payments included), for delete buttons. */
  everPaidBillIds: Set<string>
  everPaidCardAccounts: Set<string>
  everPaidBorrowingAccounts: Set<string>
}

export type ShortTermHistory = { everPaidBillIds: string[]; everPaidLiabilityAccounts: string[] }

export function buildShortTermView(
  data: ShortTermData,
  ctx: { today: IsoDate; currency: string; accounts: readonly PayingAccount[]; loans: LoanItem[]; payments: PaymentRecord[]; history: ShortTermHistory },
): ShortTermView {
  const everPaidAccounts = new Set(ctx.history.everPaidLiabilityAccounts)
  const c: Ctx = {
    today: ctx.today,
    accounts: ctx.accounts,
    loans: ctx.loans,
    payments: new Map(ctx.payments.map((p) => [p.dueItemId, p])),
    paymentList: ctx.payments,
    everPaidBillIds: new Set(ctx.history.everPaidBillIds),
    everPaidCardAccounts: everPaidAccounts,
    everPaidBorrowingAccounts: everPaidAccounts,
  }
  const cards = data.cards.map((card) => buildCard(card, data, c))
  const borrowings = data.borrowings.map((b) => buildBorrowing(b, data, c))
  const cardEmis = ctx.loans.filter((l) => l.loan.loanType === "credit_card_emi" && l.loan.archivedAt === null)
  const byCreated = <T extends { createdAt: string }>(a: { x: T }, b: { x: T }) => a.x.createdAt.localeCompare(b.x.createdAt)
  const active = cards.filter((i) => i.card.archivedAt === null).sort((a, b) => byCreated({ x: a.card }, { x: b.card }))
  const activeBorrowings = borrowings
    .filter((i) => i.borrowing.archivedAt === null)
    .sort((a, b) => Number(a.badge === "repaid") - Number(b.badge === "repaid") || byCreated({ x: a.borrowing }, { x: b.borrowing }))
  function inCurrency<T>(items: T[], currency: (i: T) => string, owed: (i: T) => number): number[] {
    return items.filter((i) => currency(i) === ctx.currency).map(owed)
  }
  return {
    cards: active,
    archivedCards: cards.filter((i) => i.card.archivedAt !== null),
    borrowings: activeBorrowings,
    archivedBorrowings: borrowings.filter((i) => i.borrowing.archivedAt !== null),
    cardEmis,
    totalOwedMinor: addMinor(
      ...inCurrency(active, (i) => i.card.currency, (i) => i.owedMinor),
      ...inCurrency(cardEmis, (i) => i.loan.currency, (i) => i.outstandingMinor),
      ...inCurrency(activeBorrowings, (i) => i.borrowing.currency, (i) => i.owedMinor),
    ),
    expenseCategories: data.expenseCategories,
  }
}

const RANK: (ReminderReason | "statement")[] = [...REMINDER_ORDER, "statement"]

/** Due soon and the bell: loan EMIs, card bills (until the minimum is covered), borrowing due dates and statements to add. */
export function buildReminders(loanReminders: Reminder<DueItem>[], loanCurrency: (item: DueItem) => string, view: ShortTermView | null, today: IsoDate): ReminderEntry[] {
  const out: ReminderEntry[] = loanReminders.map(({ item, reason, daysOverdue }) => ({
    id: item.id,
    source: "loan",
    name: item.loanName,
    label: item.label,
    dueDate: item.dueDate,
    plannedOn: item.plannedOn,
    plannedAccountName: item.plannedAccountName,
    amountMinor: item.split?.totalMinor ?? item.amountMinor,
    currency: loanCurrency(item),
    reason,
    daysOverdue,
    loanItem: item,
    cardId: null,
    billId: null,
    borrowingId: null,
  }))
  if (view) {
    for (const card of view.cards) {
      // The pending bill only; `covered` (minimum paid, or nothing owed) stops its reminders.
      for (const r of dueReminders(card.pendingBill ? [card.pendingBill] : [], today)) {
        out.push({
          id: r.item.id,
          source: "card",
          name: card.name,
          label: "Card bill",
          dueDate: r.item.dueDate,
          plannedOn: r.item.plannedOn,
          plannedAccountName: r.item.plannedAccountName,
          amountMinor: r.item.payDefaultMinor,
          currency: card.card.currency,
          reason: r.reason,
          daysOverdue: r.daysOverdue,
          loanItem: null,
          cardId: card.card.id,
          billId: r.item.id,
          borrowingId: null,
        })
      }
      if (card.statementToAdd) {
        out.push({
          id: `statement-${card.card.id}`,
          source: "card",
          name: card.name,
          label: `Add your ${card.name} statement`,
          dueDate: null,
          plannedOn: null,
          plannedAccountName: null,
          amountMinor: null,
          currency: card.card.currency,
          reason: "statement",
          daysOverdue: 0,
          loanItem: null,
          cardId: card.card.id,
          billId: null,
          borrowingId: null,
        })
      }
    }
    for (const b of view.borrowings) {
      if (!b.due) continue
      for (const r of dueReminders([b.due], today)) {
        out.push({
          id: r.item.id,
          source: "borrowing",
          name: b.name,
          label: "Repay",
          dueDate: r.item.dueDate,
          plannedOn: r.item.plannedOn,
          plannedAccountName: r.item.plannedAccountName,
          amountMinor: b.owedMinor,
          currency: b.borrowing.currency,
          reason: r.reason,
          daysOverdue: r.daysOverdue,
          loanItem: null,
          cardId: null,
          billId: null,
          borrowingId: b.borrowing.id,
        })
      }
    }
  }
  return out.sort(
    (a, b) => RANK.indexOf(a.reason) - RANK.indexOf(b.reason) || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || a.id.localeCompare(b.id),
  )
}
