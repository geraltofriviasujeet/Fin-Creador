import { z } from "zod"
import { BORROWING_BADGE_LABEL, LOAN_BADGE_LABEL, buildLoansView, cardBadgeText, loadLoansData } from "@fin-creador/api"
import { formatMoney, formatPercentFromBasisPoints } from "@fin-creador/domain"
import { type FinanceTool, type Figure, ToolError } from "./types"

// loans_and_cards (Sprint 10.2): what the person owes today, as the Loans & Liabilities page
// shows it (buildLoansView): each active loan with its next instalment, each card with what it
// owes and its latest bill, and money borrowed. Money borrowed goes by relationship only: the
// lender is a person, and their name is not sent.

const noInput = z.object({}).strict()
type NoInput = z.infer<typeof noInput>

const BORROWED_FROM: Record<string, string> = { family: "Borrowed from family", friends: "Borrowed from friends", others: "Borrowed from others" }

export const loansAndCardsTool: FinanceTool<NoInput> = {
  name: "loans_and_cards",
  description:
    "What the person owes today: each active loan (outstanding, EMI, next due date), each credit card (owed, limit used, latest bill) and money borrowed from people, with the totals the Loans page shows.",
  input: noInput,
  async run(ctx) {
    const load = await loadLoansData(ctx.supabase)
    if (!load.ok) throw new ToolError("The loans and cards couldn't be loaded.")
    const view = buildLoansView(load.data)
    const { currency, today } = view
    const money = (minor: number, c = currency) => formatMoney(minor, { currency: c })
    const shortTerm = view.shortTerm
    const cards = shortTerm?.cards ?? []
    const borrowings = (shortTerm?.borrowings ?? []).filter((b) => b.badge !== "repaid")
    const borrowedLabel = (relationship: string | null) => (relationship && BORROWED_FROM[relationship]) || "Borrowed money"

    const figures: Figure[] = [
      { label: "Loans outstanding (not card EMIs)", kind: "money", minor: view.longTermOutstandingMinor, currency },
      ...(shortTerm ? [{ label: "Cards, card EMIs and borrowing owed", kind: "money" as const, minor: shortTerm.totalOwedMinor, currency }] : []),
    ]
    const dates: string[] = []

    const loans = view.loans
      .filter((l) => l.badge !== "closed")
      .map((l) => {
        const c = l.loan.currency
        figures.push({ label: `${l.name}: outstanding`, kind: "money", minor: l.outstandingMinor, currency: c })
        figures.push({ label: `${l.name}: EMI`, kind: "money", minor: l.loan.emiMinor, currency: c })
        if (l.next) {
          figures.push({ label: `${l.name}: next due ${l.next.dueDate}`, kind: "money", minor: l.next.amountMinor, currency: c })
          dates.push(l.next.dueDate)
        }
        return {
          name: l.name,
          type: l.typeLabel,
          outstanding: money(l.outstandingMinor, c),
          emi: money(l.loan.emiMinor, c),
          next_due: l.next ? { date: l.next.dueDate, amount: money(l.next.amountMinor, c) } : null,
          status: LOAN_BADGE_LABEL[l.badge],
        }
      })

    const cardRows = cards.map((item) => {
      const c = item.card.currency
      const bill = item.latestBill
      figures.push({ label: `${item.name}: owed`, kind: "money", minor: item.owedMinor, currency: c })
      figures.push({ label: `${item.name}: limit`, kind: "money", minor: item.card.limitMinor, currency: c })
      figures.push({ label: `${item.name}: limit used`, kind: "percent", bps: item.utilisation.bps })
      if (item.creditMinor > 0) figures.push({ label: `${item.name}: in credit`, kind: "money", minor: item.creditMinor, currency: c })
      if (bill) {
        figures.push({ label: `${item.name}: bill due ${bill.dueDate}`, kind: "money", minor: bill.amountDueMinor, currency: c })
        figures.push({ label: `${item.name}: left to pay`, kind: "money", minor: bill.leftMinor, currency: c })
        if (bill.minimumDueMinor !== null) figures.push({ label: `${item.name}: minimum due`, kind: "money", minor: bill.minimumDueMinor, currency: c })
        dates.push(bill.dueDate, bill.statement.statementDate)
      }
      return {
        name: item.name,
        owed: money(item.owedMinor, c),
        in_credit: item.creditMinor > 0 ? money(item.creditMinor, c) : null,
        limit: money(item.card.limitMinor, c),
        limit_used: formatPercentFromBasisPoints(item.utilisation.bps),
        latest_bill: bill
          ? {
              statement_date: bill.statement.statementDate,
              due_date: bill.dueDate,
              amount: money(bill.amountDueMinor, c),
              minimum: bill.minimumDueMinor === null ? null : money(bill.minimumDueMinor, c),
              left_to_pay: money(bill.leftMinor, c),
            }
          : null,
        status: cardBadgeText(item),
      }
    })

    const borrowingRows = borrowings.map((b) => {
      const c = b.borrowing.currency
      const label = borrowedLabel(b.borrowing.relationship)
      figures.push({ label: `${label}: owed`, kind: "money", minor: b.owedMinor, currency: c })
      if (b.due) dates.push(b.due.dueDate)
      return {
        name: label,
        owed: money(b.owedMinor, c),
        return_by: b.due?.dueDate ?? null,
        status: BORROWING_BADGE_LABEL[b.badge],
      }
    })

    return {
      data: {
        as_of: today,
        currency,
        loans_outstanding_not_card_emis: money(view.longTermOutstandingMinor),
        cards_card_emis_and_borrowing_owed: shortTerm ? money(shortTerm.totalOwedMinor) : null,
        loans,
        cards: cardRows,
        borrowed: borrowingRows,
        note:
          loans.length + cardRows.length + borrowingRows.length === 0
            ? "The person has no active loans, cards or money borrowed."
            : "Totals are in the person's currency; a loan or card in another currency is listed, not added. Card EMIs are listed with the loans and counted in the cards total.",
      },
      figures,
      dates,
    }
  },
}
