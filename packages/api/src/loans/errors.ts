import { formatMoney } from "@fin-creador/domain"
import { shortfallMessage } from "@fin-creador/schemas"
import { type LedgerErrorLike, type LedgerMessage, ledgerErrorMessage } from "../ledger-errors"

// Database errors from loans, due items and payments (migration 20261028120000) and statutory
// dues (20261028230000) as messages for web and mobile. Raw database messages are never shown.

const BY_CODE: Record<string, LedgerMessage> = {
  FC032: { message: "Loan payments are changed from the loan, not here." },
  FC033: { message: "This loan is archived. Restore it first." },
  FC034: { message: "This EMI is already paid or was paid before you added the loan. Reload to see the latest." },
  FC036: { message: "Payments before you added the loan aren't recorded.", field: "paidOn" },
  FC037: { message: "Principal can't be more than you owe.", field: "principal" },
  FC038: { message: "A loan can't pay another loan. Choose a bank, cash or other account.", field: "accountId" },
  FC039: { message: "That date is before this account's opening balance.", field: "paidOn" },
  FC040: { message: "A loan with payments can't be deleted. Keep it archived instead." },
  FC041: { message: "Choose today or a later date.", field: "plannedOn" },
  FC042: { message: "This category is used by the app and can't be archived." },
  FC043: { message: "Check the EMI dates and try again.", field: "nextDueDate" },
  FC044: { message: "Archive the loan before deleting it." },
  FC053: { message: "This due is archived. Restore it first." },
}

const NO_DIGITS = "Leave out card and account numbers"

export type LoanErrorContext = { currency?: string; accountName?: string }

export type LoanMessage = LedgerMessage & {
  /** FC035: the paying account is short by this much; the person may "Pay anyway". */
  shortfallMinor?: number
}

export function loanErrorMessage(error: (LedgerErrorLike & { details?: string | null }) | null | undefined, ctx: LoanErrorContext = {}): LoanMessage {
  const code = error?.code
  if (code === "FC035") {
    const shortfallMinor = Number(error?.details)
    if (Number.isSafeInteger(shortfallMinor) && shortfallMinor > 0 && ctx.currency) {
      return { message: shortfallMessage(shortfallMinor, ctx.accountName ?? "this account", ctx.currency), field: "accountId", shortfallMinor }
    }
    return { message: "This account doesn't have enough money for this EMI.", field: "accountId" }
  }
  if (code === "FC052" || code === "FC054") {
    const minor = Number(error?.details)
    const amount = Number.isSafeInteger(minor) && ctx.currency ? formatMoney(minor, { currency: ctx.currency }) : null
    return code === "FC052"
      ? { message: amount ? `That's more than is still due (${amount})` : "That's more than is still due", field: "principal" }
      : { message: amount ? `Enter at least what is already paid (${amount})` : "The amount can't be less than what is already paid", field: "amount" }
  }
  if (code && BY_CODE[code]) return BY_CODE[code]
  if (code === "23514") {
    const text = error?.message ?? ""
    if (text.includes("loans_lender")) return { message: NO_DIGITS, field: "lender" }
    if (text.includes("loans_nickname")) return { message: NO_DIGITS, field: "nickname" }
  }
  if (code === "FC003") return ledgerErrorMessage(error, { dateField: "paidOn" })
  return ledgerErrorMessage(error)
}
