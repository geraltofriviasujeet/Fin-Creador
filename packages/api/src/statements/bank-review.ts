import {
  type BankLineSkipReason,
  type BankStatementCheck,
  type BankStatementLine,
  type BankStatementParse,
  type IsoDate,
  addMinor,
  bankLineDecision,
  bankStatementLineKey,
  formatMoney,
  isIsoDate,
  linePosition,
  minorToGroupedInputString,
  parseAmount,
} from "@fin-creador/domain"
import { fullDate } from "../transactions/format"
import { type RefundCandidate, suggestRefundLinks } from "./refunds"
import { OTHER_EXPENSES_NAME, type ReviewCategory, type ReviewStatus, type UnreadableRow } from "./review"

// The review of an imported bank account statement (Sprint 9b), shared by web and mobile. Pure:
// built from the parse, what the database already holds (BankImportMatches) and the person's
// categories, income sources, accounts and cards.
//
// - Keys come from the line exactly as read (bankStatementLineKey), never from edits.
// - Each line has a type. A debit starts ticked as an expense (Other expenses); it may become a
//   transfer to another own account, a card payment (through the card payment path) or be skipped.
//   A credit starts unticked with no type: income (with an income source), a transfer from another
//   own account, a refund (Sprint 9c: in an expense category, linked to the purchase it reverses
//   when one has exactly that amount left, else unlinked) or skip, and it can't be ticked until one
//   is chosen.
// - Already imported: its key is in the ledger, or (transfers) the same money is already recorded
//   as a transfer touching this account, e.g. from the other account's import; never tickable.
//   Already imported (deleted): the key's entry was voided. A line with the same date, amount and
//   direction as an existing entry is a Possible duplicate and starts unticked.
// - Lines before the account's opening balance date, or in the future, are skipped.
// - Nothing is ever ticked by the app after the review is built, and nothing is unticked by a check.

export type BankLineType = "expense" | "income" | "transfer" | "card_payment" | "refund" | "skip"

/** Types a line of each direction may take. */
export const BANK_LINE_TYPES: Record<BankStatementLine["direction"], BankLineType[]> = {
  debit: ["expense", "transfer", "card_payment", "skip"],
  credit: ["income", "transfer", "refund", "skip"],
}

export const BANK_TYPE_LABELS: Record<BankStatementLine["direction"], Record<BankLineType, string>> = {
  debit: { expense: "Expense", transfer: "Transfer to my own account", card_payment: "Credit card payment", income: "Income", refund: "Refund", skip: "Skip" },
  credit: { income: "Income", transfer: "Transfer from my own account", refund: "Refund", skip: "Skip", expense: "Expense", card_payment: "Credit card payment" },
}

/** A file with no column header or lines the bank reader can use. */
export const BANK_UNREADABLE =
  "We couldn't read this file as a bank statement. We read the text PDF or CSV from your bank when its table names the date, description, amounts (debit and credit columns, or one amount column) and balance, and its balances add up line by line or from the opening to the closing balance. Scanned or photographed statements can't be read. Your file was read on this device only and wasn't saved or uploaded. You can still add entries by hand."

/** Shown above a review read by the generic reader (not a bank-specific one). */
export const BANK_GENERIC_NOTE = "Read from the statement's table and checked against its balances; compare the lines with your file."

export const REFUND_NOTE = "A refund lowers this category's spending and adds the money back to the account. It isn't income."

export type BankImportAccount = {
  id: string
  /** As the app names the account ("HDFC Bank ··4821"). */
  name: string
  /** The bank's name only (no digits), for the file picker. */
  institution: string
  currency: string
  /** Lines before this day are skipped: the opening balance already holds them. */
  openingBalanceDate: IsoDate
}

export type BankImportOptions = {
  expenseCategories: ReviewCategory[]
  incomeSources: ReviewCategory[]
  /** Other active own accounts in the same currency (transfers). */
  accounts: { id: string; name: string }[]
  /** Active cards in the same currency (card payments). */
  cards: { id: string; name: string }[]
}

/** What the database already holds for this account and statement (loadBankImportMatches). */
export type BankImportMatches = {
  importedKeys: string[]
  deletedKeys: string[]
  /** Live income and refund (credit) and expense (debit) entries on the account in the range, other than this statement's lines. */
  entries: { date: IsoDate; amountMinor: number; direction: "debit" | "credit" }[]
  /** Live transfers touching the account in the range (money out: debit; in: credit), other than this statement's lines. */
  transfers: { date: IsoDate; amountMinor: number; direction: "debit" | "credit" }[]
  /** The account's balance in the app at the end of the statement's last day; null when not read. */
  bookBalanceMinor: number | null
  /** Purchases from the account a refund line may be linked to (loadRefundCandidates). */
  refundCandidates: RefundCandidate[]
}

export type BankReviewLine = {
  key: string
  original: BankStatementLine
  status: ReviewStatus
  skipReason: BankLineSkipReason | null
  /** imported because the same transfer is already recorded (e.g. from the other account's statement). */
  transferMatch: boolean
  ticked: boolean
  type: BankLineType | ""
  date: string
  amount: string
  /** Expense category (expense, refund) or income source, by type. */
  categoryId: string
  otherAccountId: string
  cardId: string
  /** Refunds only: the purchase it reverses ("" for none). */
  refundOfId: string
  /** The person set this line's type; a payee label is never offered over it. */
  touched: boolean
  /** The type was offered from another line of the same payee in this file; it still needs a tick. */
  suggested: boolean
}

export type BankReview = {
  lines: BankReviewLine[]
  /** For refund lines: the purchases they may be linked to. */
  refundCandidates: RefundCandidate[]
  summary: BankStatementParse["summary"]
  checks: BankStatementCheck[]
  /** Soft: the app's balance and the statement's closing differ. Never blocks Save. */
  balanceWarning: string | null
  unreadableRows: number
  unreadable: UnreadableRow[]
}

export type BankReviewContext = { accountId: string; openingBalanceDate: IsoDate; today: IsoDate; currency: string }

export const bankReviewKeys = (accountId: string, parse: Pick<BankStatementParse, "lines">): string[] =>
  parse.lines.map((line) => bankStatementLineKey(accountId, line))

const otherExpenses = (categories: readonly ReviewCategory[]) =>
  categories.find((c) => c.name.trim().toLowerCase() === OTHER_EXPENSES_NAME.toLowerCase())?.id ?? ""

/** A pool of (date, amount, direction) to mark lines against; each entry marks one line. */
function pool(items: readonly { date: string; amountMinor: number; direction: string }[]) {
  const left = new Map<string, number>()
  for (const i of items) {
    const k = `${i.date}|${i.amountMinor}|${i.direction}`
    left.set(k, (left.get(k) ?? 0) + 1)
  }
  return (line: Pick<BankStatementLine, "date" | "amountMinor" | "direction">) => {
    const k = `${line.date}|${line.amountMinor}|${line.direction}`
    const n = left.get(k) ?? 0
    if (n === 0) return false
    left.set(k, n - 1)
    return true
  }
}

export function buildBankReview(
  parse: BankStatementParse,
  matches: BankImportMatches,
  options: BankImportOptions,
  context: BankReviewContext,
  pageRowCounts?: readonly number[],
  rowLayouts?: readonly string[],
): BankReview {
  const keys = bankReviewKeys(context.accountId, parse)
  const imported = new Set(matches.importedKeys)
  const deleted = new Set(matches.deletedKeys)
  const transfer = pool(matches.transfers)
  const entry = pool(matches.entries)
  const expenseDefault = otherExpenses(options.expenseCategories)

  const lines = parse.lines.map((line, i): BankReviewLine => {
    const key = keys[i]!
    const decision = bankLineDecision(line, { accountAddedOn: context.openingBalanceDate, today: context.today })
    let status: ReviewStatus = "new"
    let transferMatch = false
    if (!decision.importable) status = "skipped"
    else if (imported.has(key)) status = "imported"
    else if (deleted.has(key)) status = "deleted"
    else if (transfer(line)) {
      status = "imported"
      transferMatch = true
    } else if (entry(line)) status = "duplicate"
    const open = status === "new" || status === "duplicate"
    const debit = line.direction === "debit"
    return {
      key,
      original: line,
      status,
      skipReason: decision.importable ? null : decision.reason,
      transferMatch,
      ticked: status === "new" && debit,
      type: open && debit ? "expense" : "",
      date: line.date,
      amount: minorToGroupedInputString(line.amountMinor, context.currency),
      categoryId: open && debit ? expenseDefault : "",
      otherAccountId: "",
      cardId: "",
      refundOfId: "",
      touched: false,
      suggested: false,
    }
  })

  return {
    lines,
    refundCandidates: matches.refundCandidates,
    summary: parse.summary,
    checks: parse.checks,
    balanceWarning: balanceWarning(parse, matches.bookBalanceMinor, context.currency),
    unreadableRows: parse.issues.length,
    unreadable: parse.issues
      .filter((issue) => issue.line > 0)
      .map((issue) => {
        const at = pageRowCounts ? linePosition(issue.line, pageRowCounts) : null
        // A row the generic reader read but whose balance doesn't follow says so before its shape.
        const shape = issue.reason === "balance_mismatch" ? `balance doesn't follow${issue.shape ? `, ${issue.shape}` : ""}` : (issue.shape ?? "")
        return { page: at?.page ?? null, row: at?.row ?? issue.line, shape, layout: rowLayouts?.[issue.line - 1] ?? "" }
      }),
  }
}

/** The statement's closing balance: as printed, else the newest line's balance. */
export function statementClosingMinor(parse: Pick<BankStatementParse, "summary" | "lines">): number | null {
  if (parse.summary.closingMinor !== null) return parse.summary.closingMinor
  if (parse.lines.length === 0) return null
  const first = parse.lines[0]!
  const last = parse.lines[parse.lines.length - 1]!
  return (first.date >= last.date ? first : last).balanceMinor
}

/** Soft warning when the app's balance on the statement's last day isn't the statement's closing. */
export function balanceWarning(parse: Pick<BankStatementParse, "summary" | "lines">, bookMinor: number | null, currency: string): string | null {
  const closing = statementClosingMinor(parse)
  if (closing === null || bookMinor === null || closing === bookMinor || parse.summary.to === null) return null
  const money = (m: number) => formatMoney(m, { currency })
  return `Your FinCreador balance differs from the bank's: on ${fullDate(parse.summary.to)} FinCreador shows ${money(bookMinor)} for this account, and the statement ends at ${money(closing)}. Lines not saved yet, or entries added by hand, can explain it. This doesn't stop Save.`
}

export const canTickBank = (line: Pick<BankReviewLine, "status" | "type">): boolean =>
  (line.status === "new" || line.status === "duplicate") && line.type !== "" && line.type !== "skip"

/**
 * Chooses a line's type (by the person): clears targets that no longer apply, unticks when it can't
 * be saved. A refund is linked to the purchase with exactly its amount left (taking its category),
 * if `candidates` has one; else it stays unlinked with no category.
 */
export function setBankLineType(line: BankReviewLine, type: BankLineType | "", options: BankImportOptions, candidates: readonly RefundCandidate[] = []): BankReviewLine {
  const next: BankReviewLine = { ...line, type, touched: true, suggested: false }
  if (type !== line.type) {
    next.categoryId = type === "expense" ? otherExpenses(options.expenseCategories) : ""
    next.otherAccountId = ""
    next.cardId = ""
    next.refundOfId = ""
    if (type === "refund") {
      const link = suggestRefundLinks([line.original], candidates)[0] ?? null
      const category = candidates.find((c) => c.id === link)?.categoryId ?? ""
      next.refundOfId = link ?? ""
      next.categoryId = options.expenseCategories.some((c) => c.id === category) ? category : ""
    }
  }
  if (!canTickBank(next)) next.ticked = false
  return next
}

/**
 * Remembers a payee's label within this file (in memory only): the type and target of line `from`
 * are offered on the other open lines of the same payee and direction that the person hasn't
 * labelled. They are unticked and marked suggested: a tick is still needed to save them.
 */
export function offerPayeeLabel(lines: readonly BankReviewLine[], from: number): BankReviewLine[] {
  const source = lines[from]!
  const payee = source.original.description
  if (payee === "" || !canTickBank(source)) return [...lines]
  return lines.map((line, i) =>
    i === from ||
    line.touched ||
    line.original.description !== payee ||
    line.original.direction !== source.original.direction ||
    !(line.status === "new" || line.status === "duplicate")
      ? line
      : // A refund link is never copied: each refund reverses its own purchase.
        { ...line, type: source.type, categoryId: source.categoryId, otherAccountId: source.otherAccountId, cardId: source.cardId, refundOfId: "", ticked: false, suggested: true },
  )
}

export type BankLineFilter = "all" | "choice" | "ticked" | "duplicates"

/** The lines a review filter shows, with their index in the review: Need a choice is open lines with no type or a suggested one. */
export function bankLinesShown(lines: readonly BankReviewLine[], filter: BankLineFilter): { line: BankReviewLine; index: number }[] {
  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      filter === "all"
        ? true
        : filter === "ticked"
          ? line.ticked
          : filter === "duplicates"
            ? line.status === "duplicate"
            : (line.status === "new" || line.status === "duplicate") && (line.type === "" || line.suggested),
    )
}

/** Page `page` (kept in range) of `count` items, `size` a page: its bounds and the number of pages. */
export function reviewPage(count: number, page: number, size: number): { current: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(count / size))
  const current = Math.min(Math.max(0, page), pages - 1)
  return { current, pages, from: current * size, to: Math.min((current + 1) * size, count) }
}

export type BankLineErrors = { date?: string; amount?: string; type?: string; target?: string }

/** Errors in a ticked line's values (also checked again on the server). */
export function bankLineErrors(
  line: Pick<BankReviewLine, "date" | "amount" | "type" | "categoryId" | "otherAccountId" | "cardId">,
  options: BankImportOptions,
  context: Pick<BankReviewContext, "openingBalanceDate" | "today" | "currency">,
): BankLineErrors {
  const errors: BankLineErrors = {}
  if (!isIsoDate(line.date)) errors.date = "Enter a date"
  else if (line.date < context.openingBalanceDate) errors.date = "Before the account's opening balance date"
  else if (line.date > context.today) errors.date = "Choose today or an earlier date"
  const amount = parseAmount(line.amount, context.currency)
  if (!amount.ok) errors.amount = amount.error === "empty" ? "Enter an amount" : "Enter an amount above zero"
  if (line.type === "") errors.type = "Choose what this is"
  else if ((line.type === "expense" || line.type === "refund") && !options.expenseCategories.some((c) => c.id === line.categoryId)) errors.target = "Choose a category"
  else if (line.type === "income" && !options.incomeSources.some((c) => c.id === line.categoryId)) errors.target = "Choose an income source"
  else if (line.type === "transfer" && !options.accounts.some((a) => a.id === line.otherAccountId)) errors.target = "Choose the other account"
  else if (line.type === "card_payment" && !options.cards.some((c) => c.id === line.cardId)) errors.target = "Choose the card"
  return errors
}

const SKIP_LABELS: Record<BankLineSkipReason, string> = { before_account: "before the account's opening balance date", future: "future dates" }

export type BankReviewTotals = {
  ticked: number
  inMinor: number
  outMinor: number
  /** Credits that still need a type (open, unticked). */
  needChoice: number
  skipped: { count: number; totalMinor: number; reasons: string[] }
}

export function bankReviewTotals(lines: readonly BankReviewLine[], currency: string): BankReviewTotals {
  let inMinor = 0
  let outMinor = 0
  let ticked = 0
  for (const line of lines) {
    if (!line.ticked) continue
    ticked += 1
    const amount = parseAmount(line.amount, currency)
    if (!amount.ok) continue
    if (line.original.direction === "credit") inMinor = addMinor(inMinor, amount.minor)
    else outMinor = addMinor(outMinor, amount.minor)
  }
  const skipped = lines.filter((l) => l.status === "skipped")
  return {
    ticked,
    inMinor,
    outMinor,
    needChoice: lines.filter((l) => (l.status === "new" || l.status === "duplicate") && l.type === "").length,
    skipped: {
      count: skipped.length,
      totalMinor: addMinor(...skipped.map((l) => l.original.amountMinor)),
      reasons: [...new Set(skipped.map((l) => l.skipReason!))].map((r) => SKIP_LABELS[r]),
    },
  }
}

/** Why the statement needs checking (the balance chain, or its own opening / closing); empty when it holds. */
export function bankCheckReasons(checks: readonly BankStatementCheck[], lines: readonly BankStatementLine[], currency: string): string[] {
  const money = (minor: number | null) => (minor === null ? "—" : formatMoney(minor, { currency }))
  return checks
    .filter((c) => c.status === "mismatch")
    .map((c) => {
      if (c.name === "balance_chain" && c.lines === undefined) {
        return "Some rows' balances don't follow from the row before them, so they aren't offered for saving: they're listed with the rows that could not be read. Add them by hand if you need them."
      }
      if (c.name === "balance_chain") {
        const first = c.lines?.[0]
        const at = first === undefined ? "" : ` (first on ${lines[first]?.date ?? "a line"})`
        return `The balances don't follow line by line${at}: each balance should be the one before it plus a credit or minus a debit. A line may not have been read.`
      }
      return c.name === "opening"
        ? `The statement doesn't add up: its lines start from ${money(c.foundMinor)}, but its own Opening Balance is ${money(c.expectedMinor)}. A line may not have been read.`
        : `The statement doesn't add up: its lines end at ${money(c.foundMinor)}, but its own Closing Balance is ${money(c.expectedMinor)}. A line may not have been read.`
    })
}

export type BankSaveBlocker = "nothing_ticked" | "line_errors" | "check_not_confirmed"

/** What stops Save. The soft balance warning never does. */
export function bankSaveBlockers(review: Pick<BankReview, "lines" | "checks">, options: BankImportOptions, context: Pick<BankReviewContext, "openingBalanceDate" | "today" | "currency">, checkConfirmed: boolean): BankSaveBlocker[] {
  const ticked = review.lines.filter((l) => l.ticked)
  const blockers: BankSaveBlocker[] = []
  if (ticked.length === 0) blockers.push("nothing_ticked")
  if (ticked.some((l) => Object.keys(bankLineErrors(l, options, context)).length > 0)) blockers.push("line_errors")
  if (review.checks.some((c) => c.status === "mismatch") && !checkConfirmed) blockers.push("check_not_confirmed")
  return blockers
}
