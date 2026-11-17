// UPI app statements (Sprint 9e) read from synthetic PDFs (test-support/synthetic-upi.ts) with the
// pdf.js Node build and the UPI caps: the four layouts, a password, a 47-page Paytm statement,
// wrapped account lines, failed and pending rows, cashback and UPI Lite. Never a real statement.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"
import { describe, expect, it } from "vitest"
import { MAX_UPI_PDF_BYTES, MAX_UPI_PDF_PAGES, readUpiStatement, upiReadFailureText } from "@fin-creador/domain"
import { syntheticPdf } from "../../test-support/synthetic-pdf"
import { PERSON, bhimPages, googlePayPages, paytmPages, phonePePages } from "../../test-support/synthetic-upi"
import { type PdfLib, readStatementPdf } from "./pdf-reader"

const lib = pdfjs as unknown as PdfLib
const UPI = { bytes: MAX_UPI_PDF_BYTES, pages: MAX_UPI_PDF_PAGES }

async function read(pages: Parameters<typeof syntheticPdf>[0], password?: string, open?: string) {
  const result = await readStatementPdf(lib, syntheticPdf(pages, password === undefined ? {} : { password }), open, UPI)
  if (result.status !== "ok") throw new Error(result.status)
  return { result, parse: readUpiStatement(result) }
}

/** No header, UPI id or reference left in what is kept (references are for keys only). */
function nothingPersonal(rows: { ref: string }[]) {
  const kept = JSON.stringify(rows.map(({ ref: _ref, ...r }) => r))
  for (const p of Object.values(PERSON)) expect(kept).not.toContain(p)
  expect(kept).not.toMatch(/@|9000000042/)
}

describe("Paytm", () => {
  it("reads every row type with tags and a bank name wrapped over two lines", async () => {
    const { parse } = await read(paytmPages())
    expect(parse?.app).toBe("paytm")
    expect(parse!.issues).toEqual([])
    expect(parse!.period).toEqual({ from: "2026-08-01", to: "2026-10-31" })
    expect(parse!.rows.map((r) => [r.date, r.kind, r.amountMinor, r.payee, r.tag, r.account.bankLabel, r.account.digits, r.status])).toEqual([
      ["2026-10-12", "paid", 6_500, "Green Leaf Cafe", "Food", "State Bank Of India", "12", "success"],
      ["2026-10-13", "sent", 100_000, "Ravi Kumar", "Money Transfer", "Example Bank", "34", "success"],
      ["2026-10-14", "received", 123_450, "Meera N", "Money Received", "Example Bank", "34", "success"],
      ["2026-10-15", "recharge", 26_500, "Jio Prepaid", "Bill Payments", "State Bank Of India", "12", "success"],
      ["2026-10-16", "paid", 8_000, "Corner Store", "Groceries", "Example Bank", "34", "failed"],
    ])
    expect(parse!.checks.every((c) => c.status === "ok")).toBe(true)
    nothingPersonal(parse!.rows)
  })

  it("a 47-page statement: every payment read, page headers and numbers skipped", async () => {
    const pages = paytmPages({ fillTo: 47 })
    expect(pages.length).toBeGreaterThanOrEqual(47)
    const { result, parse } = await read(pages)
    expect(result.pages).toBe(pages.length)
    expect(parse!.issues).toEqual([])
    const fillers = parse!.rows.filter((r) => r.payee.startsWith("Payee "))
    expect(fillers.length).toBeGreaterThan(400)
    expect(new Set(parse!.rows.map((r) => r.ref)).size).toBe(parse!.rows.length)
    expect(parse!.checks.every((c) => c.status === "ok")).toBe(true)
  }, 60_000)

  it("over the page cap is refused before anything is read", async () => {
    const result = await readStatementPdf(lib, syntheticPdf(paytmPages({ fillTo: 3 })), undefined, { bytes: MAX_UPI_PDF_BYTES, pages: 2 })
    expect(result.status).toBe("too_many_pages")
  })
})

describe("PhonePe", () => {
  it("opens with the password and reads Paid to, Received from and Bill paid", async () => {
    const pdf = syntheticPdf(phonePePages(), { password: "pp-2610" })
    expect((await readStatementPdf(lib, pdf, undefined, UPI)).status).toBe("needs_password")
    expect((await readStatementPdf(lib, pdf, "wrong", UPI)).status).toBe("wrong_password")
    const { parse } = await read(phonePePages(), "pp-2610", "pp-2610")
    expect(parse?.app).toBe("phonepe")
    expect(parse!.issues).toEqual([])
    expect(parse!.rows.map((r) => [r.date, r.kind, r.direction, r.amountMinor, r.payee, r.account.digits])).toEqual([
      ["2026-10-12", "paid", "debit", 13_900, "Tomato Foods", "1234"],
      ["2026-10-14", "received", "credit", 50_000, "Meera N", "1234"],
      ["2026-10-15", "bill", "debit", 120_000, "Example Power Ltd", "5678"],
    ])
    nothingPersonal(parse!.rows)
  })
})

describe("BHIM", () => {
  it("reads successful rows, marks failed and pending, and reads cashback", async () => {
    const { parse } = await read(bhimPages())
    expect(parse?.app).toBe("bhim")
    expect(parse!.issues).toEqual([])
    expect(parse!.rows.map((r) => [r.kind, r.status, r.amountMinor, r.payee])).toEqual([
      ["paid", "success", 13_900, "Green Leaf Cafe"],
      ["paid", "failed", 8_000, "Corner Store"],
      ["paid", "pending", 8_000, "Corner Store"],
      ["cashback", "success", 2_500, "BHIM cashback"],
      ["received", "success", 50_000, "Meera N"],
    ])
    nothingPersonal(parse!.rows)
  })
})

describe("Google Pay", () => {
  it("reads ₹ amounts with no sign, self transfers, UPI Lite top-ups and Lite payments", async () => {
    const { parse } = await read(googlePayPages())
    expect(parse?.app).toBe("google_pay")
    expect(parse!.issues).toEqual([])
    expect(parse!.rows.map((r) => [r.kind, r.direction, r.amountMinor, r.viaLite, r.toAccount?.digits ?? null])).toEqual([
      ["paid", "debit", 34_900, false, null],
      ["self_transfer", "debit", 25_579_160, false, "5678"],
      ["lite_topup", "debit", 40_000, false, null],
      ["paid", "debit", 10_000, true, null],
      ["received", "credit", 50_000, false, null],
    ])
    expect(parse!.checks.map((c) => c.status)).toEqual(["ok", "ok"])
    nothingPersonal(parse!.rows)
  })
})

it("an unknown layout gets the honest message; Copy layout has positions only", async () => {
  const pdf = await readStatementPdf(lib, syntheticPdf([[[{ x: 40, text: "Monthly account summary for Asha Example" }], [{ x: 40, text: "Opening balance 1,000.00" }]]]), undefined, UPI)
  expect(pdf.status).toBe("ok")
  if (pdf.status !== "ok") return
  expect(readUpiStatement(pdf)).toBeNull()
  const layout = upiReadFailureText(pdf)
  expect(layout).toMatch(/^No UPI app layout recognised\.\nPage 1, row 1: text x40/)
  expect(layout).not.toMatch(/Asha|summary|1,000/)
})
