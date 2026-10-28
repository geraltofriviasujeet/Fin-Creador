import { formatMoney } from "@fin-creador/domain"
import { NO_DIGITS, PRODUCT_DIGITS, REASON_DIGITS, missingPurchaseMessage, shortfallMessage } from "@fin-creador/schemas"
import { type LedgerErrorLike, type LedgerMessage, ledgerErrorMessage } from "../ledger-errors"

// Database errors from cards, statements, borrowings and their payments (migrations
// 20261028180000 and 20261028210000) as messages for web and mobile. Raw database messages are never shown.

export type CardErrorContext = {
  /** What the person is working on, for the wording. */
  subject?: "card" | "borrowing"
  currency?: string
  accountName?: string
  /** The amount field of the form: "amount" (card payment) or "principal" (bill, repayment). */
  amountField?: "amount" | "principal"
}

export type CardMessage = LedgerMessage & {
  /** FC035: the paying account is short by this much; the person may "Pay anyway". */
  shortfallMinor?: number
}

const BY_CODE: Record<string, LedgerMessage> = {
  FC032: { message: "This changes only from its card or borrowing on Loans & Liabilities." },
  FC034: { message: "This bill is already paid. Reload to see the latest." },
  FC038: { message: "Choose a bank, cash or other account.", field: "accountId" },
  FC039: { message: "That date is before this account's opening balance.", field: "paidOn" },
  FC041: { message: "Choose today or a later date.", field: "dueDate" },
  FC046: { message: "A statement with this date is already entered for this card.", field: "statementDate" },
  FC049: { message: "Only purchases (expenses) can be recorded on a card." },
  FC050: { message: "It has purchases, statements or payments, so it can't be deleted. Archive it once nothing is owed." },
  FC051: { message: "The due date can't be before the statement date or the day you borrowed the money.", field: "dueDate" },
}

const detailMinor = (error: { details?: string | null } | null | undefined): number | null => {
  const n = Number(error?.details)
  return error?.details !== null && error?.details !== undefined && Number.isSafeInteger(n) ? n : null
}

export function cardErrorMessage(error: (LedgerErrorLike & { details?: string | null }) | null | undefined, ctx: CardErrorContext = {}): CardMessage {
  const code = error?.code
  const subject = ctx.subject ?? "card"
  const currency = ctx.currency
  const money = (minor: number) => (currency ? formatMoney(minor, { currency }) : null)
  if (code === "FC035") {
    const short = detailMinor(error)
    const what = subject === "card" ? "this card" : "this repayment"
    if (short !== null && short > 0 && currency) {
      return { message: shortfallMessage(short, ctx.accountName ?? "this account", currency, what), field: "accountId", shortfallMinor: short }
    }
    return { message: "This account doesn't have enough money for this payment.", field: "accountId" }
  }
  if (code === "FC045") {
    const owed = detailMinor(error)
    const thing = subject === "card" ? "card" : "borrowing"
    if (owed !== null && owed > 0 && money(owed)) return { message: `You still owe ${money(owed)} on this ${thing}. Archive it once nothing is owed.` }
    if (owed !== null && owed < 0 && money(-owed)) {
      return { message: `This ${thing} has ${money(-owed)} ${subject === "card" ? "in credit" : "overpaid"}. Archive it once the balance is zero.` }
    }
    return { message: `Archive this ${thing} once its balance is zero.` }
  }
  if (code === "FC047") {
    const owed = detailMinor(error)
    const message = owed !== null && currency ? missingPurchaseMessage(Math.max(owed, 0), currency) : "That's more than you owe on this card. Record the missing purchase first"
    return { message, field: ctx.amountField ?? "amount" }
  }
  if (code === "FC037") {
    const owed = detailMinor(error)
    return { message: owed !== null && money(owed) ? `That's more than you owe (${money(owed)})` : "That's more than you owe", field: "principal" }
  }
  if (code === "FC036") {
    return {
      message: subject === "card" ? "That's before you added the card: it's in the amount owed you entered then." : "That date is before you borrowed the money.",
      field: "paidOn",
    }
  }
  if (code === "FC048") return { message: `This ${subject} is archived. Restore it first.` }
  if (code && BY_CODE[code]) return BY_CODE[code]
  if (code === "23514") {
    const text = error?.message ?? ""
    if (text.includes("credit_cards_issuer")) return { message: NO_DIGITS, field: "issuer" }
    if (text.includes("credit_cards_nickname")) return { message: NO_DIGITS, field: "nickname" }
    if (text.includes("borrowings_lender")) return { message: NO_DIGITS, field: "lender" }
    if (text.includes("credit_cards_product")) return { message: PRODUCT_DIGITS, field: "product" }
    if (text.includes("borrowings_reason")) return { message: REASON_DIGITS, field: "reason" }
    if (text.includes("borrowings_relationship")) return { message: "Choose family, friends or others", field: "relationship" }
  }
  if (code === "FC003") return ledgerErrorMessage(error, { dateField: "paidOn" })
  return ledgerErrorMessage(error)
}
