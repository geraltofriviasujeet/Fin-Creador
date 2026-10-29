// readStatementPdf on synthetic PDFs written in the test (apps/web/test-support/synthetic-pdf.ts),
// with the pdf.js Node build: a text PDF in the two PNB layouts, a password-protected one, one with
// no text, and the caps. Never a real statement.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"
import { describe, expect, it } from "vitest"
import { MAX_STATEMENT_PDF_BYTES, MAX_STATEMENT_PDF_PAGES, parseCardStatement, statementNeedsCheck } from "@fin-creador/domain"
import { columns, pnbRealLayoutPages, pnbStatementPages as pnbPages, syntheticPdf } from "../../test-support/synthetic-pdf"
import { type PdfLib, readStatementPdf } from "./pdf-reader"

const lib = pdfjs as unknown as PdfLib

describe.each([true, false])("readStatementPdf: PNB text PDF (network column: %s)", (network) => {
  it("reads rows by position and the PNB parser gets every line, summary and check", async () => {
    const read = await readStatementPdf(lib, syntheticPdf(pnbPages(network)))
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return
    expect(read.pages).toBe(2)
    const parsed = parseCardStatement(read.text, "Punjab National Bank")
    expect(parsed.summary).toEqual({ statementDate: "2026-10-15", dueDate: "2026-11-04", totalMinor: 233_400, minimumMinor: 11_670 })
    expect(parsed.lines.map((l) => [l.date, l.amountMinor, l.direction, l.kind, l.description])).toEqual([
      ["2026-09-18", 150_000, "credit", "payment", "PAYMENT RECEIVED - THANK YOU"],
      ["2026-09-21", 178_400, "debit", "purchase", "FRESH BASKET STORES BENGAL"],
      ["2026-10-10", 50_000, "debit", "fee", "LATE PAYMENT FEE"],
      ["2026-10-10", 5_000, "debit", "tax", "IGST @18% ON LATE PAYMENT FEE"],
    ])
    expect(parsed.issues).toEqual([])
    expect(statementNeedsCheck(parsed)).toBe(false)
    expect(JSON.stringify(parsed)).not.toMatch(/0042|5555|EXAMPLE PERSON/)
  })
})

describe.each([
  ["details on the baseline, second line below", { date: 0, network: 2, line1: 0, line2: -10 }],
  ["date centred on two lines of details", { date: 0, network: -1.5, line1: 5, line2: -5 }],
  ["cells drifting, first line overprinted", { date: -4, network: 1, line1: 1, line2: -9, overprint: true }],
])("readStatementPdf: PNB network column with wrapped, offset details (%s)", (_, wrapped) => {
  it("drops the whole network cell and joins the wrapped details in order", async () => {
    const read = await readStatementPdf(lib, syntheticPdf(pnbPages(true, { wrapped })))
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return
    const parsed = parseCardStatement(read.text, "Punjab National Bank")
    expect(parsed.lines.map((l) => l.description)).toEqual([
      "PAYMENT RECEIVED - THANK YOU",
      "FRESH BASKET STORES BENGAL",
      "LATE PAYMENT FEE",
      "IGST @18% ON LATE PAYMENT FEE",
    ])
    expect(parsed.issues).toEqual([])
    expect(statementNeedsCheck(parsed)).toBe(false)
    expect(JSON.stringify(parsed)).not.toMatch(/RUPAY|0042/)
  })
})

it("leaves the statement date empty when the Invoice Date can't be read (no guess from another date)", async () => {
  const read = await readStatementPdf(lib, syntheticPdf(pnbPages(false, { dateLayout: "unreadable" })))
  expect(read.status === "ok" && parseCardStatement(read.text, "Punjab National Bank").summary).toMatchObject({ statementDate: null, dueDate: "2026-11-04" })
})

describe.each(["label-row", "beside", "next-row", "one-row"] as const)("readStatementPdf: PNB statement date layout %s", (dateLayout) => {
  it("reads the statement date from Invoice Date only, never the earlier header date", async () => {
    const read = await readStatementPdf(lib, syntheticPdf(pnbPages(false, { dateLayout, headerDate: "2026-10-13" })))
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return
    expect(parseCardStatement(read.text, "Punjab National Bank").summary).toMatchObject({ statementDate: "2026-10-15", dueDate: "2026-11-04" })
  })
})

describe("readStatementPdf: PNB real layout (boxed values, no Dr marker, split network group, totals below)", () => {
  it("reads 2 debits and a Cr payment, no unreadable rows, the dates and passing self-checks", async () => {
    const read = await readStatementPdf(lib, syntheticPdf(pnbRealLayoutPages()))
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return
    const parsed = parseCardStatement(read.text, "Punjab National Bank")
    expect(parsed.lines.map((l) => [l.date, l.amountMinor, l.direction, l.kind, l.description])).toEqual([
      ["2026-08-25", 150_000, "credit", "payment", "PAYMENT RECEIVED BBPS"],
      ["2026-08-28", 178_400, "debit", "purchase", "FRESH BASKET STORES KOLKATA IN"],
      ["2026-09-02", 50_064, "debit", "purchase", "CITYFUEL POINT HOWRAH IN"],
    ])
    expect(parsed.issues).toEqual([])
    expect(parsed.summary).toEqual({ statementDate: "2026-09-20", dueDate: "2026-10-10", totalMinor: 228_464, minimumMinor: 11_423 })
    expect(parsed.checks.map((c) => [c.name, c.status])).toEqual([["summary", "ok"], ["purchases", "ok"], ["invoice_total", "ok"]])
    expect(statementNeedsCheck(parsed)).toBe(false)
    expect(JSON.stringify(parsed)).not.toMatch(/0042|5555|RUPAY|INV123/)
  })
})

describe("readStatementPdf: password", () => {
  const pdf = syntheticPdf(pnbPages(false), { password: "fake-pass-1" })

  it("asks for the password, refuses a wrong one, and reads with the right one", async () => {
    expect(await readStatementPdf(lib, pdf)).toEqual({ status: "needs_password" })
    expect(await readStatementPdf(lib, pdf, "wrong")).toEqual({ status: "wrong_password" })
    const read = await readStatementPdf(lib, pdf, "fake-pass-1")
    expect(read.status).toBe("ok")
    if (read.status === "ok") expect(parseCardStatement(read.text, "Punjab National Bank").lines).toHaveLength(4)
  })

  it("leaves the caller's bytes usable for a retry", async () => {
    const copy = pdf.slice()
    await readStatementPdf(lib, copy, "wrong")
    expect(copy).toEqual(pdf)
  })
})

describe("readStatementPdf: what it refuses", () => {
  it("a PDF with no text", async () => {
    expect(await readStatementPdf(lib, syntheticPdf([[]], { noText: true }))).toEqual({ status: "no_text" })
  })

  it("a file above the size cap, before reading it", async () => {
    expect(await readStatementPdf(lib, new Uint8Array(MAX_STATEMENT_PDF_BYTES + 1))).toEqual({ status: "too_large" })
  })

  it("more pages than the cap", async () => {
    const pages = Array.from({ length: MAX_STATEMENT_PDF_PAGES + 1 }, () => columns([40], [["Page"]]))
    expect(await readStatementPdf(lib, syntheticPdf(pages))).toEqual({ status: "too_many_pages" })
  })

  it("something that is not a PDF", async () => {
    expect(await readStatementPdf(lib, new TextEncoder().encode("not a pdf"))).toEqual({ status: "unreadable" })
  })
})
