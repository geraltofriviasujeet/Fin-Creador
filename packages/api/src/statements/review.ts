import {
  type CardLineSkipReason,
  type CardStatementParse,
  type CardStatementSummary,
  type IsoDate,
  type StatementCheck,
  type StatementLine,
  addMinor,
  cardLineDecision,
  formatMoney,
  isIsoDate,
  linePosition,
  minorToGroupedInputString,
  parseAmount,
  statementLineKey,
} from "@fin-creador/domain"

// The review of an imported card statement (Sprint 9a.4), shared by web and mobile: one row per
// line read, with a tick and the date, amount and category the person may change. Pure: built
// from the parse, what the database already holds (matches) and the categories.
//
// - Request keys come from the line exactly as read (statementLineKey), never from edits, so the
//   same statement imported again maps to the same keys.
// - Skipped (payments, refunds, card EMIs, lines before the card was added or in the future) are
//   listed, never tickable. A key already in the ledger is "Already imported", never tickable; one
//   whose entry was deleted (voided, no newer version) is "Already imported (deleted)", never tickable.
// - A line with the same date and amount as an existing entry on the card is a "Possible
//   duplicate" and starts unticked (each existing entry marks one line).
// - Fee, interest and tax lines default to the system category Bank charges & interest; other
//   lines to Other expenses. Nothing is ever unticked by the app after the person ticks it.

export const BANK_CHARGES_KEY = "bank_charges"
export const OTHER_EXPENSES_NAME = "Other expenses"

export type ReviewCategory = { id: string; name: string; systemKey: string | null }

/** What the database already holds, read for this card and statement (loadImportMatches). */
export type ImportMatches = {
  /** Request keys of this statement's lines already in the ledger and counting (or edited since). */
  importedKeys: string[]
  /** Request keys whose ledger row was deleted (voided, no newer version): never imported again. */
  deletedKeys: string[]
  /** Current expense entries on the card in the statement's date range, other than this statement's lines. */
  cardEntries: { date: IsoDate; amountMinor: number }[]
  /** Enter statement already holds a statement for this card and date. */
  statementExists: boolean
}

export type ReviewStatus = "new" | "duplicate" | "imported" | "deleted" | "skipped"

export type ReviewLine = {
  key: string
  /** The line as read; its key never changes with edits. */
  original: StatementLine
  status: ReviewStatus
  skipReason: CardLineSkipReason | null
  ticked: boolean
  /** Editable values. */
  date: string
  amount: string
  categoryId: string
}

export type Review = {
  lines: ReviewLine[]
  statement: CardStatementSummary & { exists: boolean }
  checks: StatementCheck[]
  unreadableRows: number
  /** Where each unreadable row is and its masked shape (no text or numbers), in text order. */
  unreadable: UnreadableRow[]
}

/** An unreadable row: its page and row in the PDF (null when not known) and its masked shape. */
export type UnreadableRow = { page: number | null; row: number; shape: string }

export type ReviewContext = { cardId: string; cardAddedOn: IsoDate; today: IsoDate; currency: string }

/** The key every line of a statement is saved under (the date as read; "" when none was read). */
export function reviewKeys(cardId: string, parse: CardStatementParse): string[] {
  const statementDate = parse.summary.statementDate ?? ""
  return parse.lines.map((line) => statementLineKey(cardId, statementDate, line))
}

function defaultCategory(line: StatementLine, categories: readonly ReviewCategory[]): string {
  if (line.kind === "fee" || line.kind === "interest" || line.kind === "tax") {
    const bank = categories.find((c) => c.systemKey === BANK_CHARGES_KEY)
    if (bank) return bank.id
  }
  return categories.find((c) => c.name.trim().toLowerCase() === OTHER_EXPENSES_NAME.toLowerCase())?.id ?? ""
}

export function buildReview(
  parse: CardStatementParse,
  matches: ImportMatches,
  categories: readonly ReviewCategory[],
  context: ReviewContext,
  /** Rows each PDF page gave (from the reader), to place unreadable rows; else they're numbered in the text. */
  pageRowCounts?: readonly number[],
): Review {
  const keys = reviewKeys(context.cardId, parse)
  const imported = new Set(matches.importedKeys)
  const deleted = new Set(matches.deletedKeys)
  const existing = new Map<string, number>()
  for (const entry of matches.cardEntries) {
    const k = `${entry.date}|${entry.amountMinor}`
    existing.set(k, (existing.get(k) ?? 0) + 1)
  }

  const lines = parse.lines.map((line, i): ReviewLine => {
    const key = keys[i]!
    const decision = cardLineDecision(line, { cardAddedOn: context.cardAddedOn, today: context.today })
    let status: ReviewStatus = "new"
    if (!decision.importable) status = "skipped"
    else if (imported.has(key)) status = "imported"
    else if (deleted.has(key)) status = "deleted"
    else {
      const k = `${line.date}|${line.amountMinor}`
      const left = existing.get(k) ?? 0
      if (left > 0) {
        status = "duplicate"
        existing.set(k, left - 1)
      }
    }
    return {
      key,
      original: line,
      status,
      skipReason: decision.importable ? null : decision.reason,
      ticked: status === "new",
      date: line.date,
      amount: minorToGroupedInputString(line.amountMinor, context.currency),
      categoryId: status === "new" || status === "duplicate" ? defaultCategory(line, categories) : "",
    }
  })

  return {
    lines,
    statement: { ...parse.summary, exists: matches.statementExists },
    checks: parse.checks,
    unreadableRows: parse.issues.length,
    unreadable: parse.issues
      .filter((issue) => issue.line > 0)
      .map((issue) => {
        const at = pageRowCounts ? linePosition(issue.line, pageRowCounts) : null
        return { page: at?.page ?? null, row: at?.row ?? issue.line, shape: issue.shape ?? "" }
      }),
  }
}

export const canTick = (line: Pick<ReviewLine, "status">): boolean => line.status === "new" || line.status === "duplicate"

export type LineErrors = { date?: string; amount?: string; categoryId?: string }

/** Errors in a line's edited values (checked for ticked lines only). */
export function lineErrors(
  line: Pick<ReviewLine, "date" | "amount" | "categoryId">,
  categories: readonly ReviewCategory[],
  context: Pick<ReviewContext, "cardAddedOn" | "today" | "currency">,
): LineErrors {
  const errors: LineErrors = {}
  if (!isIsoDate(line.date)) errors.date = "Enter a date"
  else if (line.date < context.cardAddedOn) errors.date = "Before you added the card"
  else if (line.date > context.today) errors.date = "Choose today or an earlier date"
  const amount = parseAmount(line.amount, context.currency)
  if (!amount.ok) errors.amount = amount.error === "empty" ? "Enter an amount" : "Enter an amount above zero"
  if (!categories.some((c) => c.id === line.categoryId)) errors.categoryId = "Choose a category"
  return errors
}

const SKIP_LABELS: Record<CardLineSkipReason, string> = {
  payment: "payments",
  refund: "refunds",
  emi: "card EMIs",
  before_card: "before you added the card",
  future: "future dates",
}

export type ReviewTotals = {
  ticked: number
  tickedMinor: number
  skipped: { count: number; totalMinor: number; reasons: string[] }
}

export function reviewTotals(review: Pick<Review, "lines">, currency: string): ReviewTotals {
  let tickedMinor = 0
  let ticked = 0
  for (const line of review.lines) {
    if (!line.ticked) continue
    const amount = parseAmount(line.amount, currency)
    ticked += 1
    if (amount.ok) tickedMinor = addMinor(tickedMinor, amount.minor)
  }
  const skippedLines = review.lines.filter((l) => l.status === "skipped")
  const reasons = [...new Set(skippedLines.map((l) => l.skipReason!))].map((r) => SKIP_LABELS[r])
  return {
    ticked,
    tickedMinor,
    skipped: { count: skippedLines.length, totalMinor: addMinor(...skippedLines.map((l) => l.original.amountMinor)), reasons },
  }
}

/** Why the statement needs checking, in plain words; empty when its own arithmetic holds. */
export function checkReasons(checks: readonly StatementCheck[], currency: string): string[] {
  const money = (minor: number | null) => (minor === null ? "—" : formatMoney(minor, { currency }))
  return checks
    .filter((c) => c.status === "mismatch")
    .map((c) =>
      c.name === "summary"
        ? `The statement's summary (previous balance + purchases + cash advances − payments) comes to ${money(c.foundMinor)}, but its Total Amount Due is ${money(c.expectedMinor)}.`
        : `The debit lines read add up to ${money(c.foundMinor)}, but the statement's Total Invoice Value is ${money(c.expectedMinor)}. A line may not have been read.`,
    )
}

export type SaveBlocker = "nothing_ticked" | "line_errors" | "check_not_confirmed" | "statement_date_missing"

/** What stops Save: nothing ticked, a ticked line with errors, or an unconfirmed "Check this statement". */
export function saveBlockers(
  review: Review,
  categories: readonly ReviewCategory[],
  context: Pick<ReviewContext, "cardAddedOn" | "today" | "currency">,
  checkConfirmed: boolean,
  /**
   * The statement to enter too, if any: Save then works with no line ticked (statement only), and
   * needs its date (never guessed: empty when the Invoice Date couldn't be read).
   */
  statement: { enters: boolean; date: string } = { enters: false, date: "" },
): SaveBlocker[] {
  const ticked = review.lines.filter((l) => l.ticked)
  const blockers: SaveBlocker[] = []
  if (ticked.length === 0 && !statement.enters) blockers.push("nothing_ticked")
  if (statement.enters && !isIsoDate(statement.date)) blockers.push("statement_date_missing")
  if (ticked.some((l) => Object.keys(lineErrors(l, categories, context)).length > 0)) blockers.push("line_errors")
  if (checkReasons(review.checks, context.currency).length > 0 && !checkConfirmed) blockers.push("check_not_confirmed")
  return blockers
}

/** Shown at an empty Statement date: the date is read only from the Invoice Date label, never guessed. */
export const STATEMENT_DATE_MISSING = "Couldn't read the statement date; enter it"

/** A warning when the statement's dates look wrong (shown with Enter statement); null when they look right. */
export function statementDatesWarning(statementDate: string, dueDate: string): string | null {
  if (!isIsoDate(statementDate) || !isIsoDate(dueDate)) return null
  return dueDate < statementDate ? "Check statement dates: the due date is before the statement date. Compare them with your PDF." : null
}
