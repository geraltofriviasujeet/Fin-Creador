// UPI app statements (Sprint 9e) laid out with the word positions of the owner's real Paytm, PhonePe
// and BHIM statements (test-support/synthetic-upi-layouts.ts, from masked layouts; every name and
// number invented), read through pdf.js and the UPI readers. Each read is checked against the
// counts the owner's statements have. Never a real statement.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"
import { describe, expect, it } from "vitest"
import { upiCountReasons, upiReadText } from "@fin-creador/api"
import { MAX_UPI_PDF_BYTES, MAX_UPI_PDF_PAGES, type UpiRow, linePosition, readUpiStatement } from "@fin-creador/domain"
import { syntheticPdf } from "../../test-support/synthetic-pdf"
import {
  PAYTM_ACCOUNTS,
  PAYTM_ODD_BLOCKS,
  bhimLayoutPages,
  bhimLayoutPayments,
  paytmLayoutPages,
  paytmLayoutPayee,
  paytmLayoutPayments,
  phonePeLayoutPages,
  phonePeLayoutPayments,
} from "../../test-support/synthetic-upi-layouts"
import { type PdfLib, readStatementPdf } from "./pdf-reader"

const lib = pdfjs as unknown as PdfLib

async function readPdf(pages: Parameters<typeof syntheticPdf>[0], landscape = false) {
  const result = await readStatementPdf(lib, syntheticPdf(pages, { landscape }), undefined, { bytes: MAX_UPI_PDF_BYTES, pages: MAX_UPI_PDF_PAGES })
  if (result.status !== "ok") throw new Error(result.status)
  const parse = readUpiStatement(result)
  if (!parse) throw new Error("not read")
  return { parse, result }
}

const read = async (pages: Parameters<typeof syntheticPdf>[0], landscape = false) => (await readPdf(pages, landscape)).parse

const tally = (rows: readonly UpiRow[], key: (r: UpiRow) => string) => {
  const out: Record<string, number> = {}
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1
  return out
}

/** No UPI id, phone or person's name kept outside the reference. */
const nothingPersonal = (rows: readonly UpiRow[]) => {
  const kept = JSON.stringify(rows.map(({ ref: _ref, ...r }) => r))
  expect(kept).not.toMatch(/@|9000000042|Asha|asha/)
}

describe("Paytm, as laid out", () => {
  const payments = paytmLayoutPayments()

  it("the fixture has the owner's shapes: 161 blocks raised 3 points, wrapped labels, notes", () => {
    expect(payments.filter((p) => p.raised)).toHaveLength(161)
    expect(payments.filter((p) => p.note).length).toBeGreaterThan(0)
    expect(payments.filter((p) => p.wrappedName).length).toBeGreaterThan(0)
  })

  it("reads 300 paid and 13 received, per account as the summary counts them", async () => {
    const parse = await read(paytmLayoutPages())
    expect(parse.app).toBe("paytm")
    expect(parse.issues).toEqual([])
    expect(parse.count).toEqual({ read: 313, total: 313, printed: true })
    expect(upiReadText(parse.count)).toBe("313 of 313 payments read")
    expect(tally(parse.rows, (r) => `${r.account.bankLabel} ··${r.account.digits} ${r.direction}`)).toEqual({
      "HDFC Bank ··00 debit": 146,
      "Punjab National Bank ··66 debit": 71,
      "State Bank Of India ··65 debit": 61,
      "Canara Bank ··22 debit": 22,
      "Canara Bank ··22 credit": 13,
    })
    expect(parse.accountCounts.every((c) => c.found === c.expected)).toBe(true)
    expect(parse.accountCounts).toHaveLength(8)
    expect(upiCountReasons(parse)).toEqual([])
    expect(parse.checks.map((c) => c.status)).toEqual(["ok", "ok"])
    expect(parse.period).toEqual({ from: "2026-10-01", to: "2026-11-15" })
  })

  it("each block's amount, kind, payee, tag and account are its own", async () => {
    const parse = await read(paytmLayoutPages())
    const byRef = new Map(parse.rows.map((r) => [r.ref, r]))
    for (const p of payments) {
      const row = byRef.get(p.ref)
      expect(row, p.ref).toBeDefined()
      expect([row!.amountMinor, row!.kind, row!.payee, row!.tag, row!.account.bankLabel]).toEqual([
        p.minor,
        p.kind === "Received from" ? "received" : p.kind === "Money sent to" ? "sent" : "paid",
        paytmLayoutPayee(p),
        p.tag,
        PAYTM_ACCOUNTS[p.bank].label,
      ])
    }
    nothingPersonal(parse.rows)
  })

  it("reads the five odd blocks: a note over several rows, a wrapped UPI ID, a wrapped name, the tag pushed down", async () => {
    const odd = payments.filter((p) => p.odd !== null)
    expect(odd.map((p) => p.bank)).toEqual(PAYTM_ODD_BLOCKS.map((b) => b.bank))
    const parse = await read(paytmLayoutPages())
    const byRef = new Map(parse.rows.map((r) => [r.ref, r]))
    for (const p of odd) {
      const row = byRef.get(p.ref)
      expect(row && [row.amountMinor, row.payee, row.tag, row.account.bankLabel, row.account.digits], `odd block ${p.odd}`).toEqual([
        p.minor,
        PAYTM_ODD_BLOCKS[p.odd!]!.payee,
        p.tag,
        PAYTM_ACCOUNTS[p.bank].label,
        PAYTM_ACCOUNTS[p.bank].digits,
      ])
    }
  })

  it("an odd block that still can't be read is listed by its page and row, and the count says so", async () => {
    // No UPI reference in one PNB and one HDFC odd block: 311 of 313, as the owner's file read before.
    const broken = new Set([PAYTM_ODD_BLOCKS.findIndex((b) => b.bank === "pnb"), PAYTM_ODD_BLOCKS.findIndex((b) => b.bank === "hdfc")])
    const changed = payments.map((p) => (p.odd !== null && broken.has(p.odd) ? { ...p, ref: "" } : p))
    const { parse, result } = await readPdf(paytmLayoutPages(changed))
    expect(parse.count).toEqual({ read: 311, total: 313, printed: true })
    expect(parse.issues.map((i) => i.reason)).toEqual(["no_reference", "no_reference"])
    expect(upiCountReasons(parse)).toEqual([
      "The statement lists 313 payments; 311 were read.",
      "HDFC Bank ··00: the statement lists 146 payments made; 145 were read.",
      "Punjab National Bank ··66: the statement lists 71 payments made; 70 were read.",
    ])
    const dates = changed.filter((p) => p.ref === "").map((p) => p.date).sort()
    const placed = parse.issues.map((i) => {
      const at = linePosition(i.line, result.pageRowCounts)!
      expect(at.page).toBeGreaterThan(1)
      // The page's row is the block's date row.
      const before = result.pageRowCounts.slice(0, at.page - 1).reduce((a, n) => a + n, 0)
      return result.rows[before + at.row - 1]!.cells[0]
    })
    expect(placed.sort()).toEqual(dates)
  })

  it("a short read is said: the summary's counts against the payments read", async () => {
    const drop = new Set(payments.filter((p) => p.bank === "pnb").slice(0, 2).map((p) => p.i))
    const parse = await read(paytmLayoutPages(payments, drop))
    expect(parse.count).toEqual({ read: 311, total: 313, printed: true })
    expect(upiCountReasons(parse)).toEqual([
      "The statement lists 313 payments; 311 were read.",
      "Punjab National Bank ··66: the statement lists 71 payments made; 69 were read.",
    ])
  })
})

describe("PhonePe, as laid out", () => {
  it("reads all 70, amounts of 10,000 or more wrapped under INR, and masked payees", async () => {
    const payments = phonePeLayoutPayments()
    const parse = await read(phonePeLayoutPages())
    expect(parse.app).toBe("phonepe")
    expect(parse.issues).toEqual([])
    expect(parse.count).toEqual({ read: 70, total: 70, printed: false })
    const byRef = new Map(parse.rows.map((r) => [r.ref, r]))
    for (const p of payments) {
      const row = byRef.get(p.utr)!
      expect([row.amountMinor, row.direction, row.payee]).toEqual([p.minor, p.kind === "Received from" ? "credit" : "debit", p.masked ? "" : p.name])
    }
    expect(payments.filter((p) => p.wrapped).map((p) => byRef.get(p.utr)!.amountMinor >= 1_000_000)).toEqual(Array(7).fill(true))
    nothingPersonal(parse.rows)
  })
})

describe("BHIM, as laid out", () => {
  it("reads all 70 rows (67 SUCCESS), direction from DR/CR, NPCI BHIM cashback, the last 4 digits", async () => {
    const payments = bhimLayoutPayments()
    const parse = await read(bhimLayoutPages(), true)
    expect(parse.app).toBe("bhim")
    expect(parse.issues).toEqual([])
    expect(parse.count).toEqual({ read: 70, total: 70, printed: false })
    expect(tally(parse.rows, (r) => r.status)).toEqual({ success: 67, pending: 2, failed: 1 })
    expect(parse.period).toEqual({ from: "2026-10-01", to: "2026-11-15" })
    expect(tally(parse.rows, (r) => `${r.account.bankLabel} ${r.account.digits}`)).toEqual({ "HDFC Bank LTD 1234": 24, "Punjab National Bank 5678": 23, "Canara Bank 2345": 23 })
    const byRef = new Map(parse.rows.map((r) => [r.ref, r]))
    for (const p of payments) {
      const row = byRef.get(p.id)!
      expect([row.amountMinor, row.direction, row.kind, row.payee]).toEqual([
        p.minor,
        p.credit ? "credit" : "debit",
        p.cashback ? "cashback" : p.credit ? "received" : "paid",
        p.cashback ? "BHIM cashback" : expect.stringMatching(new RegExp(`^${p.name.split(" ")[0]}`)),
      ])
    }
    nothingPersonal(parse.rows)
  })
})
