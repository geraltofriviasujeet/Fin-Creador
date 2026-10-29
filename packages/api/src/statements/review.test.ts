import { describe, expect, it } from "vitest"
import { type CardStatementParse, type StatementLine, statementLineKey } from "@fin-creador/domain"
import { buildReview, canTick, checkReasons, lineErrors, reviewKeys, reviewTotals, saveBlockers } from "./review"

// Synthetic statement lines only.
const CARD = "00000000-0000-4000-8000-0000000000c1"
const context = { cardId: CARD, cardAddedOn: "2026-09-01", today: "2026-10-29", currency: "INR" }
const categories = [
  { id: "cat-other", name: "Other expenses", systemKey: null },
  { id: "cat-bank", name: "Bank charges & interest", systemKey: "bank_charges" },
  { id: "cat-food", name: "Groceries", systemKey: null },
]

const line = (over: Partial<StatementLine>): StatementLine => ({
  date: "2026-09-21", amountMinor: 178_400, direction: "debit", kind: "purchase",
  description: "FRESH BASKET", foreignCurrency: null, occurrence: 0, ...over,
})

const parse: CardStatementParse = {
  summary: { statementDate: "2026-10-15", dueDate: "2026-11-04", totalMinor: 233_400, minimumMinor: 11_670 },
  lines: [
    line({ date: "2026-09-18", amountMinor: 150_000, direction: "credit", kind: "payment", description: "PAYMENT RECEIVED" }),
    line({}),
    line({ date: "2026-10-10", amountMinor: 50_000, kind: "fee", description: "LATE PAYMENT FEE" }),
    line({ date: "2026-10-10", amountMinor: 5_000, kind: "tax", description: "IGST" }),
    line({ date: "2026-10-12", amountMinor: 9_950, kind: "interest", description: "FINANCE CHARGES" }),
    line({ date: "2026-08-30", amountMinor: 1_000, description: "BEFORE THE CARD" }),
    line({ date: "2026-10-02", amountMinor: 30_000, description: "PHONE MART" }),
    line({ date: "2026-10-03", amountMinor: 12_000, description: "CINEMA" }),
  ],
  issues: [{ line: 40, reason: "no_amount" }],
  checks: [
    { name: "summary", status: "ok", foundMinor: 233_400, expectedMinor: 233_400 },
    { name: "invoice_total", status: "ok", foundMinor: 223_350, expectedMinor: 223_350 },
  ],
}

const keys = reviewKeys(CARD, parse)
const none = { importedKeys: [], deletedKeys: [], cardEntries: [], statementExists: false }

describe("reviewKeys", () => {
  it("derives each key from the card, the statement date and the line as read", () => {
    expect(keys[1]).toBe(statementLineKey(CARD, "2026-10-15", parse.lines[1]!))
    expect(new Set(keys).size).toBe(keys.length)
    expect(reviewKeys(CARD, parse)).toEqual(keys)
  })
})

describe("buildReview", () => {
  const review = buildReview(parse, none, categories, context)

  it("ticks new spending, defaults categories, and lists skipped lines unticked", () => {
    expect(review.lines.map((l) => [l.original.description, l.status, l.skipReason, l.ticked, l.categoryId])).toEqual([
      ["PAYMENT RECEIVED", "skipped", "payment", false, ""],
      ["FRESH BASKET", "new", null, true, "cat-other"],
      ["LATE PAYMENT FEE", "new", null, true, "cat-bank"],
      ["IGST", "new", null, true, "cat-bank"],
      ["FINANCE CHARGES", "new", null, true, "cat-bank"],
      ["BEFORE THE CARD", "skipped", "before_card", false, ""],
      ["PHONE MART", "new", null, true, "cat-other"],
      ["CINEMA", "new", null, true, "cat-other"],
    ])
    expect(review.lines[1]!.amount).toBe("1,784")
    expect(review.unreadableRows).toBe(1)
    expect(review.statement).toEqual({ ...parse.summary, exists: false })
  })

  it("marks a key already in the ledger as Already imported, never tickable", () => {
    const r = buildReview(parse, { ...none, importedKeys: [keys[6]!] }, categories, context)
    expect(r.lines[6]).toMatchObject({ status: "imported", ticked: false })
    expect(canTick(r.lines[6]!)).toBe(false)
  })

  it("marks a key whose entry was deleted as Already imported (deleted), never tickable", () => {
    const r = buildReview(parse, { ...none, deletedKeys: [keys[7]!] }, categories, context)
    expect(r.lines[7]).toMatchObject({ status: "deleted", ticked: false })
    expect(canTick(r.lines[7]!)).toBe(false)
  })

  it("marks a line matching an existing card entry as a possible duplicate, unticked; one entry marks one line", () => {
    const twice = { ...parse, lines: [...parse.lines, line({ date: "2026-10-03", amountMinor: 12_000, description: "CINEMA", occurrence: 1 })] }
    const r = buildReview(twice, { ...none, cardEntries: [{ date: "2026-10-03", amountMinor: 12_000 }] }, categories, context)
    expect(r.lines.slice(-2).map((l) => [l.status, l.ticked])).toEqual([["duplicate", false], ["new", true]])
    expect(canTick(r.lines.at(-2)!)).toBe(true)
  })

  it("falls back to Other expenses for fees when Bank charges & interest does not exist yet, else to no category", () => {
    const withoutBank = buildReview(parse, none, categories.filter((c) => c.systemKey === null), context)
    expect(withoutBank.lines[2]!.categoryId).toBe("cat-other")
    expect(buildReview(parse, none, [categories[2]!], context).lines[1]!.categoryId).toBe("")
  })

  it("keeps keys from the parsed line whatever is edited", () => {
    const r = buildReview(parse, none, categories, context)
    const edited = { ...r.lines[1]!, date: "2026-09-22", amount: "1,800" }
    expect(edited.key).toBe(keys[1])
  })
})

describe("lineErrors", () => {
  const ok = { date: "2026-10-01", amount: "450.50", categoryId: "cat-food" }
  it("accepts a valid edit", () => expect(lineErrors(ok, categories, context)).toEqual({}))
  it("checks the date, the amount and the category", () => {
    expect(lineErrors({ ...ok, date: "" }, categories, context)).toEqual({ date: "Enter a date" })
    expect(lineErrors({ ...ok, date: "2026-08-31" }, categories, context)).toEqual({ date: "Before you added the card" })
    expect(lineErrors({ ...ok, date: "2026-10-30" }, categories, context)).toEqual({ date: "Choose today or an earlier date" })
    expect(lineErrors({ ...ok, amount: "" }, categories, context)).toEqual({ amount: "Enter an amount" })
    expect(lineErrors({ ...ok, amount: "0" }, categories, context)).toEqual({ amount: "Enter an amount above zero" })
    expect(lineErrors({ ...ok, categoryId: "someone-elses" }, categories, context)).toEqual({ categoryId: "Choose a category" })
  })
})

describe("reviewTotals", () => {
  it("adds the ticked lines' edited amounts and the skipped lines with their reasons", () => {
    const r = buildReview(parse, none, categories, context)
    r.lines[1] = { ...r.lines[1]!, amount: "1,800" }
    r.lines[7] = { ...r.lines[7]!, ticked: false }
    expect(reviewTotals(r, "INR")).toEqual({
      ticked: 5,
      tickedMinor: 180_000 + 50_000 + 5_000 + 9_950 + 30_000,
      skipped: { count: 2, totalMinor: 151_000, reasons: ["payments", "before you added the card"] },
    })
  })
})

describe("checkReasons and saveBlockers", () => {
  const mismatch: CardStatementParse = {
    ...parse,
    checks: [
      { name: "summary", status: "mismatch", foundMinor: 243_400, expectedMinor: 233_400 },
      { name: "invoice_total", status: "mismatch", foundMinor: 213_400, expectedMinor: 223_350 },
    ],
  }

  it("explains each mismatch in plain words with the figures", () => {
    expect(checkReasons(mismatch.checks, "INR")).toEqual([
      "The statement's summary (previous balance + purchases + cash advances − payments) comes to ₹2,434, but its Total Amount Due is ₹2,334.",
      "The debit lines read add up to ₹2,134, but the statement's Total Invoice Value is ₹2,233.50. A line may not have been read.",
    ])
    expect(checkReasons(parse.checks, "INR")).toEqual([])
  })

  it("blocks Save until the check is confirmed, a line is ticked and every ticked line is valid", () => {
    const r = buildReview(mismatch, none, categories, context)
    expect(saveBlockers(r, categories, context, false)).toEqual(["check_not_confirmed"])
    expect(saveBlockers(r, categories, context, true)).toEqual([])
    // Confirming never unticks anything.
    expect(r.lines.filter((l) => l.ticked)).toHaveLength(6)
    r.lines[1] = { ...r.lines[1]!, amount: "" }
    expect(saveBlockers(r, categories, context, true)).toEqual(["line_errors"])
    const none2 = { ...r, lines: r.lines.map((l) => ({ ...l, ticked: false })) }
    expect(saveBlockers(none2, categories, context, true)).toEqual(["nothing_ticked"])
  })
})
