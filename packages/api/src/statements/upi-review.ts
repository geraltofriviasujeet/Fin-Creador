import {
  type IsoDate,
  type UpiAccountRef,
  type UpiApp,
  type UpiCheck,
  type UpiRow,
  type UpiStatementParse,
  addDays,
  formatMoney,
  isIsoDate,
  linePosition,
  minorToGroupedInputString,
  parseAmount,
  upiBankLabelKey,
  upiRowKey,
} from "@fin-creador/domain"
import { CATEGORY_SLOTS, type CategorySlot, merchantSlot, paytmTagSlot } from "@fin-creador/schemas"
import type { ReviewCategory, ReviewStatus, UnreadableRow } from "./review"

// The review of an imported UPI app statement (Sprint 9e), shared by web and mobile. Pure: built
// from the parse, the person's account matches, what the database already holds and the
// categories found for each payee.
//
// - Accounts: each payment names the person's bank account (bank name and last digits). The first
//   time, the person says which of their accounts it is (remembered per person and app); payments
//   on an account still unmatched are not imported, and counted.
// - Types: Paid to, Recharge of and Bill paid are expenses; Money sent to is an expense in "Money
//   sent to people"; Received from waits for the person (income, refund or skip; never income by
//   default); BHIM cashback is income (an "other" income source). Google Pay: a self transfer is a
//   transfer between two matched accounts; with a UPI Lite account, a top-up is a transfer into it
//   and Lite payments are expenses from it; without one (declined), Lite payments are expenses from
//   the linked bank and top-ups are skipped, so the same money is never spent twice. Failed and
//   pending payments are skipped and counted.
// - Categories, in order: Paytm's tag (fixed map; its Miscellaneous tag only after everything
//   else), the person's last category for the same payee, the merchant list, PhonePe's Bill paid
//   (Utilities & bills), Claude's suggestion, Miscellaneous. Each line shows where its category came from.
// - Already imported: the key (from the UPI reference) is in the ledger. Possible duplicate: an
//   entry on the same account with the same amount and direction within a day either side (a late
//   payment can post the next day), typed by hand or from a bank statement; each entry marks one
//   payment, the nearest date first. Possible duplicates wait for the person's answer in one dialog.
// - Payments before the account's opening balance date, or in the future, are skipped.

export type UpiLineType = "expense" | "income" | "refund" | "transfer" | "skip"

export type UpiCategorySource = "tag" | "history" | "merchant" | "rule" | "claude" | "default"

export const UPI_CATEGORY_SOURCE_LABELS: Record<UpiCategorySource, string> = {
  tag: "Paytm tag",
  history: "Your history",
  merchant: "Merchant list",
  rule: "Bill paid",
  claude: "Suggested by Claude",
  default: "Default",
}

export type UpiSkipReason = "failed" | "pending" | "unmatched" | "lite_topup" | "before_account" | "future"

export const UPI_SKIP_TEXT: Record<UpiSkipReason, string> = {
  failed: "Skipped: failed payment",
  pending: "Skipped: pending payment",
  unmatched: "Skipped: account not matched",
  lite_topup: "Skipped: UPI Lite top-up (Lite payments come from your bank account)",
  before_account: "Skipped: before the account's opening balance date",
  future: "Skipped: future date",
}

export type UpiCategory = ReviewCategory & { key?: string | null }

export type UpiImportAccount = { id: string; name: string; kind: string; openingBalanceDate: IsoDate }

export type UpiImportOptions = {
  /** Active bank, cash and other accounts in the profile currency. */
  accounts: UpiImportAccount[]
  expenseCategories: UpiCategory[]
  /** Income sources; `sourceType` "other" takes cashback. */
  incomeSources: (ReviewCategory & { sourceType: string | null })[]
}

/** A remembered match: a statement's bank account, or the Google Pay UPI Lite choice (account, or null when declined). */
export type UpiAccountMatch =
  | { kind: "bank"; app: UpiApp; bankLabel: string; digits: string; accountId: string }
  | { kind: "upi_lite"; app: "google_pay"; accountId: string | null }

/** An entry already in the ledger on one of the statement's accounts (for duplicates). */
export type UpiExistingEntry = {
  id: string
  type: "income" | "expense" | "refund" | "transfer"
  accountId: string
  counterAccountId: string | null
  date: IsoDate
  amountMinor: number
  note: string | null
  categoryName: string | null
}

export type UpiMatches = { importedKeys: string[]; deletedKeys: string[]; entries: UpiExistingEntry[] }

export type UpiReviewLine = {
  key: string
  original: UpiRow
  status: ReviewStatus
  skipReason: UpiSkipReason | null
  ticked: boolean
  type: UpiLineType | ""
  /** The account the money left (expense, transfer) or arrived in (income, refund); "" when unmatched. */
  accountId: string
  /** Transfers: the account it went to. */
  counterAccountId: string
  categoryId: string
  categorySource: UpiCategorySource | null
  date: string
  amount: string
  /** Possible duplicates: the entry it may repeat. */
  duplicateOf: UpiExistingEntry | null
}

export type UpiReview = {
  app: UpiApp
  lines: UpiReviewLine[]
  period: UpiStatementParse["period"]
  checks: UpiCheck[]
  unreadableRows: number
  unreadable: UnreadableRow[]
}

export type UpiReviewContext = { today: IsoDate; currency: string }

/** A statement account as shown and matched. */
export type UpiAccountNeed = { app: UpiApp; bankLabel: string; label: string; digits: string; payments: number }

const refKey = (app: UpiApp, ref: UpiAccountRef) => `${app}\u0000${upiBankLabelKey(ref.bankLabel)}\u0000${ref.digits}`

/** The statement's bank accounts (successful payments only), each with how many payments name it. */
export function upiAccountsNeeded(parse: UpiStatementParse): UpiAccountNeed[] {
  const seen = new Map<string, UpiAccountNeed>()
  const add = (ref: UpiAccountRef) => {
    const k = refKey(parse.app, ref)
    const need = seen.get(k) ?? { app: parse.app, bankLabel: upiBankLabelKey(ref.bankLabel), label: ref.bankLabel, digits: ref.digits, payments: 0 }
    need.payments++
    seen.set(k, need)
  }
  for (const row of parse.rows) {
    if (row.status !== "success") continue
    add(row.account)
    if (row.toAccount) add(row.toAccount)
  }
  return [...seen.values()]
}

/** The matched account for a statement account, when it is still an active account of the person. */
export function matchedAccount(matches: readonly UpiAccountMatch[], options: UpiImportOptions, app: UpiApp, ref: UpiAccountRef): string | null {
  const label = upiBankLabelKey(ref.bankLabel)
  const m = matches.find((x) => x.kind === "bank" && x.app === app && x.bankLabel === label && x.digits === ref.digits)
  return m?.accountId && options.accounts.some((a) => a.id === m.accountId) ? m.accountId : null
}

/** Google Pay statements with UPI Lite payments or top-ups need the Lite choice. */
export const upiLiteNeeded = (parse: UpiStatementParse): boolean =>
  parse.app === "google_pay" && parse.rows.some((r) => r.status === "success" && (r.viaLite || r.kind === "lite_topup"))

/** The UPI Lite choice: undefined when never asked, null when declined, else the account (still active). */
export function upiLiteChoice(matches: readonly UpiAccountMatch[], options: UpiImportOptions): string | null | undefined {
  const m = matches.find((x) => x.kind === "upi_lite")
  if (!m) return undefined
  if (m.accountId === null) return null
  return options.accounts.some((a) => a.id === m.accountId) ? m.accountId : undefined
}

/** The person's category for a slot: by stable key, then the default's name, then the icon; "" when none. */
export function slotCategoryId(slot: CategorySlot, categories: readonly UpiCategory[]): string {
  const def: { key?: string; icon: string; names: readonly string[] } = CATEGORY_SLOTS[slot]
  if (def.key) {
    const keyed = categories.find((c) => c.key === def.key)
    if (keyed) return keyed.id
  }
  for (const name of def.names) {
    const named = categories.find((c) => c.name.trim().toLowerCase() === name.toLowerCase())
    if (named) return named.id
  }
  return categories.find((c) => c.icon === def.icon && c.systemKey === null)?.id ?? ""
}

/** A payee as compared with history (lower case, spaces collapsed), as public.payee_key. */
export const payeeKey = (name: string): string => name.replace(/\s+/g, " ").trim().toLowerCase()

/** Payments whose category is looked for (expenses other than money sent to people). */
const wantsCategory = (row: UpiRow) => row.status === "success" && (row.kind === "paid" || row.kind === "recharge" || row.kind === "bill")

/** The category from the rules alone (no model): tag, history, merchant list, Bill paid; null when none applies. */
export function ruleCategory(
  row: UpiRow,
  categories: readonly UpiCategory[],
  history: ReadonlyMap<string, string>,
): { categoryId: string; source: UpiCategorySource } | null {
  const tag = paytmTagSlot(row.tag)
  if (tag && tag !== "misc") {
    const id = slotCategoryId(tag, categories)
    if (id) return { categoryId: id, source: "tag" }
  }
  const past = history.get(payeeKey(row.payee))
  if (past && categories.some((c) => c.id === past)) return { categoryId: past, source: "history" }
  const merchant = row.payee ? merchantSlot(row.payee) : null
  if (merchant) {
    const id = slotCategoryId(merchant, categories)
    if (id) return { categoryId: id, source: "merchant" }
  }
  if (row.kind === "bill") {
    const id = slotCategoryId("bills", categories)
    if (id) return { categoryId: id, source: "rule" }
  }
  return null
}

/** Payee names the rules leave without a category: each once, with a short id (what may be sent to the model). */
export function namesToSuggest(parse: UpiStatementParse, categories: readonly UpiCategory[], history: ReadonlyMap<string, string>): { id: string; name: string }[] {
  const names = new Map<string, string>()
  for (const row of parse.rows) {
    if (!wantsCategory(row) || row.payee === "") continue
    if (ruleCategory(row, categories, history)) continue
    const k = payeeKey(row.payee)
    if (!names.has(k)) names.set(k, row.payee)
  }
  return [...names.values()].map((name, i) => ({ id: i.toString(36), name }))
}

/** Every payee name the statement has (for the history lookup). */
export const upiPayees = (parse: UpiStatementParse): string[] => [...new Set(parse.rows.filter((r) => r.payee !== "").map((r) => r.payee))]

/** Keys of every payment, for the lookup of what is already imported. */
export const upiReviewKeys = (parse: UpiStatementParse): string[] => parse.rows.map((r) => upiRowKey(r))

/** Direction of an existing entry as seen from `accountId`. */
function entryDirection(e: UpiExistingEntry, accountId: string): "debit" | "credit" | null {
  if (e.type === "transfer") return e.accountId === accountId ? "debit" : e.counterAccountId === accountId ? "credit" : null
  if (e.accountId !== accountId) return null
  return e.type === "expense" ? "debit" : "credit"
}

const dayDiff = (a: IsoDate, b: IsoDate) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000

export type UpiReviewInput = {
  matches: readonly UpiAccountMatch[]
  options: UpiImportOptions
  existing: UpiMatches
  history: ReadonlyMap<string, string>
  /** Model suggestions by payee key (slot); empty when the model wasn't used. */
  suggestions: ReadonlyMap<string, CategorySlot>
  context: UpiReviewContext
  pageRowCounts?: readonly number[]
  rowLayouts?: readonly string[]
}

export function buildUpiReview(parse: UpiStatementParse, input: UpiReviewInput): UpiReview {
  const { matches, options, existing, history, suggestions, context } = input
  const categories = options.expenseCategories
  const imported = new Set(existing.importedKeys)
  const deleted = new Set(existing.deletedKeys)
  const lite = upiLiteChoice(matches, options)
  const misc = slotCategoryId("misc", categories)
  const moneySent = slotCategoryId("money_sent", categories)
  const cashbackSource = options.incomeSources.find((s) => s.sourceType === "other")?.id ?? ""
  const opening = new Map(options.accounts.map((a) => [a.id, a.openingBalanceDate]))
  const used = new Set<string>()

  const lines = parse.rows.map((row): UpiReviewLine => {
    const key = upiRowKey(row)
    const base: UpiReviewLine = {
      key,
      original: row,
      status: "new",
      skipReason: null,
      ticked: false,
      type: "",
      accountId: "",
      counterAccountId: "",
      categoryId: "",
      categorySource: null,
      date: row.date,
      amount: minorToGroupedInputString(row.amountMinor, context.currency),
      duplicateOf: null,
    }
    const skip = (reason: UpiSkipReason): UpiReviewLine => ({ ...base, status: "skipped", skipReason: reason })
    if (row.status !== "success") return skip(row.status)

    const bank = matchedAccount(matches, options, parse.app, row.account)
    let line: UpiReviewLine
    switch (row.kind) {
      case "lite_topup":
        if (lite === null) return skip("lite_topup")
        line = { ...base, type: "transfer", accountId: bank ?? "", counterAccountId: lite ?? "" }
        break
      case "self_transfer":
        line = { ...base, type: "transfer", accountId: bank ?? "", counterAccountId: row.toAccount ? (matchedAccount(matches, options, parse.app, row.toAccount) ?? "") : "" }
        break
      case "received":
        line = { ...base, accountId: bank ?? "" }
        break
      case "cashback":
        line = { ...base, type: "income", accountId: bank ?? "", categoryId: cashbackSource, categorySource: cashbackSource ? "default" : null }
        break
      case "sent":
        line = { ...base, type: "expense", accountId: bank ?? "", categoryId: moneySent || misc, categorySource: moneySent ? "rule" : misc ? "default" : null }
        break
      default: {
        const from = row.viaLite && lite ? lite : bank
        const found = ruleCategory(row, categories, history)
        const suggested = suggestions.get(payeeKey(row.payee))
        const suggestedId = suggested ? slotCategoryId(suggested, categories) : ""
        const pick =
          found ??
          (suggestedId ? { categoryId: suggestedId, source: "claude" as const } : null) ??
          (paytmTagSlot(row.tag) === "misc" && misc ? { categoryId: misc, source: "tag" as const } : null) ??
          (misc ? { categoryId: misc, source: "default" as const } : null)
        line = { ...base, type: "expense", accountId: from ?? "", categoryId: pick?.categoryId ?? "", categorySource: pick?.source ?? null }
      }
    }
    if (!line.accountId || (line.type === "transfer" && (!line.counterAccountId || line.counterAccountId === line.accountId))) return skip("unmatched")
    if (row.date > context.today) return skip("future")
    const opens = [opening.get(line.accountId), line.type === "transfer" ? opening.get(line.counterAccountId) : undefined].filter((d): d is string => !!d)
    if (opens.some((d) => row.date < d)) return skip("before_account")
    if (imported.has(key)) return { ...line, status: "imported" }
    if (deleted.has(key)) return { ...line, status: "deleted" }
    return { ...line, ticked: line.type !== "" && (line.type === "transfer" || line.categoryId !== "") }
  })

  // Possible duplicates: the nearest unused entry within a day, same account, amount and direction.
  const order = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.status === "new").sort((a, b) => a.l.original.date.localeCompare(b.l.original.date))
  for (const { l, i } of order) {
    const candidates = existing.entries
      .filter((e) => !used.has(e.id) && e.amountMinor === l.original.amountMinor && entryDirection(e, l.accountId) === l.original.direction && dayDiff(e.date, l.original.date) <= 1)
      .sort((a, b) => dayDiff(a.date, l.original.date) - dayDiff(b.date, l.original.date))
    const match = candidates[0]
    if (!match) continue
    used.add(match.id)
    lines[i] = { ...l, status: "duplicate", ticked: false, duplicateOf: match }
  }

  const unreadable = parse.issues
    .filter((issue) => issue.line > 0)
    .map((issue): UnreadableRow => {
      const place = input.pageRowCounts ? linePosition(issue.line, input.pageRowCounts) : null
      return { page: place?.page ?? null, row: place?.row ?? issue.line, shape: issue.shape ?? "", layout: input.rowLayouts?.[issue.line - 1] ?? "" }
    })
  return { app: parse.app, lines, period: parse.period, checks: parse.checks, unreadableRows: parse.issues.length, unreadable }
}

/** "Add all", "Skip all" or one payment's answer in the duplicates dialog: a tick, nothing else. */
export function answerDuplicates(lines: readonly UpiReviewLine[], answer: "add" | "skip", keys?: ReadonlySet<string>): UpiReviewLine[] {
  return lines.map((l) => (l.status === "duplicate" && (!keys || keys.has(l.key)) ? { ...l, ticked: answer === "add" && l.type !== "" } : l))
}

/** Lines a person may tick: new or a possible duplicate, with a type. */
export const canTickUpi = (line: Pick<UpiReviewLine, "status" | "type">): boolean => (line.status === "new" || line.status === "duplicate") && line.type !== "" && line.type !== "skip"

/** The type change of a Received from line: income, refund (both with a category or source) or skip. */
export function setUpiLineType(line: UpiReviewLine, type: UpiLineType | ""): UpiReviewLine {
  if (type === "" || type === "skip") return { ...line, type, ticked: false, categoryId: "", categorySource: null }
  return { ...line, type, categoryId: type === line.type ? line.categoryId : "", categorySource: type === line.type ? line.categorySource : null }
}

export type UpiLineErrors = Partial<Record<"date" | "amount" | "type" | "category" | "account", string>>

export function upiLineErrors(line: Pick<UpiReviewLine, "type" | "date" | "amount" | "accountId" | "counterAccountId" | "categoryId">, options: UpiImportOptions, context: UpiReviewContext): UpiLineErrors {
  const errors: UpiLineErrors = {}
  const account = options.accounts.find((a) => a.id === line.accountId)
  if (!account) errors.account = "Match this account first"
  if (!isIsoDate(line.date)) errors.date = "Enter a date"
  else if (line.date > context.today) errors.date = "Can't be in the future"
  else if (account && line.date < account.openingBalanceDate) errors.date = "Before the account's opening balance date"
  const amount = parseAmount(line.amount, context.currency)
  if (!amount.ok) errors.amount = "Enter an amount above zero"
  if (line.type === "" || line.type === "skip") errors.type = "Choose what this is"
  else if (line.type === "transfer") {
    const counter = options.accounts.find((a) => a.id === line.counterAccountId)
    if (!counter || counter.id === line.accountId) errors.account = "Match both accounts first"
    else if (isIsoDate(line.date) && line.date < counter.openingBalanceDate) errors.date = "Before the account's opening balance date"
  } else if (line.type === "income") {
    if (!options.incomeSources.some((s) => s.id === line.categoryId)) errors.category = "Choose an income source"
  } else if (!options.expenseCategories.some((c) => c.id === line.categoryId)) errors.category = "Choose a category"
  return errors
}

export type UpiTotals = {
  ticked: number
  outMinor: number
  inMinor: number
  needChoice: number
  duplicates: number
  skipped: Partial<Record<UpiSkipReason, number>>
}

export function upiReviewTotals(lines: readonly UpiReviewLine[], currency: string): UpiTotals {
  const totals: UpiTotals = { ticked: 0, outMinor: 0, inMinor: 0, needChoice: 0, duplicates: 0, skipped: {} }
  for (const l of lines) {
    if (l.status === "skipped" && l.skipReason) totals.skipped[l.skipReason] = (totals.skipped[l.skipReason] ?? 0) + 1
    if (l.status === "duplicate") totals.duplicates++
    if ((l.status === "new" || l.status === "duplicate") && l.type === "") totals.needChoice++
    if (!l.ticked) continue
    totals.ticked++
    const amount = parseAmount(l.amount, currency)
    if (!amount.ok) continue
    if (l.original.direction === "debit") totals.outMinor += amount.minor
    else totals.inMinor += amount.minor
  }
  return totals
}

/** "Check this statement" reasons from the statement's own totals. */
export function upiCheckReasons(checks: readonly UpiCheck[], currency: string): string[] {
  const label = { sent_total: "money paid", received_total: "money received" } as const
  return checks
    .filter((c) => c.status === "mismatch" && c.expectedMinor !== null)
    .map((c) => `The statement's total ${label[c.name]} is ${formatMoney(c.expectedMinor!, { currency })}; the payments read add up to ${formatMoney(c.foundMinor, { currency })}.`)
}

/** The range to look for existing entries in: a day either side of the payments. */
export function upiMatchRange(parse: UpiStatementParse, today: IsoDate): { from: IsoDate; to: IsoDate } {
  const dates = parse.rows.map((r) => r.date).sort()
  const from = dates[0] ?? parse.period.from ?? today
  const to = dates.at(-1) ?? parse.period.to ?? today
  return { from: addDays(from, -1), to: addDays(to, 1) }
}
