import { type IsoDate, type MoratoriumInterest, moratoriumDates } from "@fin-creador/domain"

// What correcting a loan's terms will do (revise_loan, migration 20261115180000), shown before
// saving: what is owed before and after, and how many pending instalments are rebuilt. The
// same rules as the database, which records the same figures in loan_revisions. Pure.

export type RevisionItem = {
  kind: string
  seq: number
  status: string
  amountDueMinor: number
  /** Any payment, voided ones included. */
  hasPayment: boolean
}

export type RevisionState = {
  /** What was owed when tracking started (the account's opening balance, positive). */
  openingOutstandingMinor: number
  trackingStartedOn: IsoDate
  /** Owed now. */
  owedMinor: number
  items: RevisionItem[]
}

export type RevisionTerms = {
  outstandingMinor: number
  /** EMIs to schedule (instalment_months). */
  remainingMonths: number
  firstDueDate: IsoDate
  moratoriumMonths: number
  moratoriumInterest: MoratoriumInterest | null
  moratoriumMonthlyInterestMinor: number
  emiMinor: number
}

export type RevisionPreview = {
  /** A payment or a settled instalment exists: payments stay, the dates and moratorium can't change. */
  hasHistory: boolean
  owedBeforeMinor: number
  owedAfterMinor: number
  /** Pending instalments replaced, removed, added or given a new amount. */
  rebuilt: number
}

const removable = (i: RevisionItem) => (i.status === "pending" || i.status === "before_tracking") && !i.hasPayment

/** History: any payment (voided ones count), or any instalment neither pending nor before tracking. */
export function loanHasHistory(items: readonly RevisionItem[]): boolean {
  return items.some((i) => i.hasPayment || (i.status !== "pending" && i.status !== "before_tracking"))
}

export function revisionPreview(state: RevisionState, next: RevisionTerms): RevisionPreview {
  const hasHistory = loanHasHistory(state.items)
  const owedAfterMinor = state.owedMinor + next.outstandingMinor - state.openingOutstandingMinor
  const interest = next.moratoriumInterest === "pay_monthly" ? next.moratoriumMonthlyInterestMinor : 0

  if (!hasHistory) {
    // Everything is rebuilt as on the day the loan was added: every EMI is pending, and
    // moratorium months from that day on.
    const interestMonths = interest > 0 ? moratoriumDates(next.firstDueDate, next.moratoriumMonths).filter((d) => d >= state.trackingStartedOn).length : 0
    return { hasHistory, owedBeforeMinor: state.owedMinor, owedAfterMinor, rebuilt: next.remainingMonths + interestMonths }
  }

  const emis = state.items.filter((i) => i.kind === "loan_emi")
  const removed = emis.filter((i) => i.seq > next.remainingMonths && removable(i))
  const kept = emis.filter((i) => !removed.includes(i))
  const updated = kept.filter((i) => i.status === "pending" && i.amountDueMinor !== next.emiMinor).length
  const pendingInterest = state.items.filter((i) => i.kind === "loan_interest" && i.status === "pending")
  const interestUpdated = pendingInterest.filter((i) => i.amountDueMinor !== interest).length
  const lastSeq = Math.max(0, ...kept.map((i) => i.seq))
  const added = Math.max(0, next.remainingMonths - lastSeq)
  return { hasHistory, owedBeforeMinor: state.owedMinor, owedAfterMinor, rebuilt: removed.length + updated + interestUpdated + added }
}
