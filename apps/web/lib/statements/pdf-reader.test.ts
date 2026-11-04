// readStatementPdf on synthetic PDFs written in the test (apps/web/test-support/synthetic-pdf.ts),
// with the pdf.js Node build: a text PDF in the two PNB layouts, a password-protected one, one with
// no text, and the caps. Never a real statement.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"
import { describe, expect, it } from "vitest"
import { MAX_STATEMENT_PDF_BYTES, MAX_STATEMENT_PDF_PAGES, bankStatementNeedsCheck, parseCardStatement, parsePnbSavingsStatementText, statementNeedsCheck, statementVerifiesItself } from "@fin-creador/domain"
import { columns, genericStatementPages, pnbRealLayoutPages, pnbSavingsPages, pnbStatementPages as pnbPages, savingsDefaultRows, syntheticPdf } from "../../test-support/synthetic-pdf"
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

it("a PNB statement with a refund: the credit is a refund line and the statement still checks itself", async () => {
  const read = await readStatementPdf(lib, syntheticPdf(pnbPages(false, { refundMinor: 178_400 })))
  expect(read.status).toBe("ok")
  if (read.status !== "ok") return
  const parsed = parseCardStatement(read.text, "Punjab National Bank")
  expect(parsed.summary.totalMinor).toBe(55_000)
  expect(parsed.lines.at(-1)).toMatchObject({ date: "2026-10-13", amountMinor: 178_400, direction: "credit", kind: "refund", description: "REFUND FRESH BASKET STORES" })
  expect(parsed.issues).toEqual([])
  expect(statementNeedsCheck(parsed)).toBe(false)
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

describe("readStatementPdf: PNB real layout with small print beside two rows (shapes from the owner's Copy layout)", () => {
  it("reads both rows (a debit, and a payment whose Cr is a piece of its own), with the small print in rows of its own", async () => {
    const read = await readStatementPdf(lib, syntheticPdf(pnbRealLayoutPages({ smallPrint: true })))
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return
    const parsed = parseCardStatement(read.text, "Punjab National Bank")
    expect(parsed.issues).toEqual([])
    expect(parsed.lines.map((l) => [l.date, l.amountMinor, l.direction, l.kind, l.description]).slice(3)).toEqual([
      ["2026-09-08", 504_664, "debit", "purchase", "SKYLINE TRAVELS ONLINE BOOKINGS IND"],
      ["2026-09-10", 150_000, "credit", "payment", "PAYMENT RECEIVED THANKYOU"],
    ])
    expect(parsed.checks.map((c) => [c.name, c.status])).toEqual([["summary", "ok"], ["purchases", "ok"], ["invoice_total", "ok"]])
    expect(statementNeedsCheck(parsed)).toBe(false)
    expect(JSON.stringify(parsed.lines)).not.toMatch(/POINTS|REDEEM/)
  })
})

describe("readStatementPdf: another bank's statement and the general reader", () => {
  it("verifies itself when its summary and debit lines add up, and not when they don't", async () => {
    for (const [balanced, verifies] of [[true, true], [false, false]] as const) {
      const read = await readStatementPdf(lib, syntheticPdf(genericStatementPages({ balanced })))
      expect(read.status).toBe("ok")
      if (read.status !== "ok") continue
      const parsed = parseCardStatement(read.text, "Example Bank")
      expect(parsed.lines).toHaveLength(4)
      expect(statementVerifiesItself(parsed)).toBe(verifies)
    }
  })
})

describe("readStatementPdf: masked row layouts for rows the reader can't use", () => {
  it("gives every text line a layout, and the unreadable row's has its pieces' kinds and positions only", async () => {
    const read = await readStatementPdf(lib, syntheticPdf(pnbPages(true, { unreadableRow: true })))
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return
    expect(read.rowLayouts).toHaveLength(read.text.split("\n").length)
    const parsed = parseCardStatement(read.text, "Punjab National Bank")
    expect(parsed.issues).toHaveLength(1)
    const layout = read.rowLayouts[parsed.issues[0]!.line - 1]!
    expect(layout).toMatch(/^date x\d+ w\d+ c11 dy0 \| date x\d+ w\d+ c11 dy0 \| text .* \| text x\d+ w\d+ c16 dy0$/)
    expect(read.rowLayouts.join("\n")).not.toMatch(/MYSTERY|OCT|RUPAY|0042|1784/)
  })
})

describe("readStatementPdf: PNB savings account statement", () => {
  it("reads every line with its balance, joins wrapped remarks, keeps the UPI payee only, and nothing above the header", async () => {
    const read = await readStatementPdf(lib, syntheticPdf(pnbSavingsPages()))
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return
    const parsed = parsePnbSavingsStatementText(read.text)
    expect(parsed.issues).toEqual([])
    expect(parsed.lines.map((l) => [l.date, l.amountMinor, l.direction, l.description])).toEqual([
      ["2026-10-28", 64_900, "debit", "RAVI KUMAR"],
      ["2026-10-27", 233_400, "debit", "CARD PAYMENT PNB RUPAY"],
      ["2026-10-26", 120_000, "credit", "RAVI KUMAR"],
      ["2026-10-25", 500_000, "debit", "IMPS/TRANSFER TO OWN ACCOUNT"],
      ["2026-10-24", 64_900, "debit", "RAVI KUMAR"],
      ["2026-10-23", 178_400, "debit", "FRESH BASKET"],
      ["2026-10-22", 5_000_000, "credit", "NEFT/SALARY OCT/EXAMPLE EMPLOYER PVT LTD"],
    ])
    expect(parsed.checks.map((c) => [c.name, c.status])).toEqual([["balance_chain", "ok"], ["opening", "ok"], ["closing", "ok"]])
    expect(JSON.stringify(parsed)).not.toMatch(/0000111122223333|EXAMPLE PERSON|EXAMPLE ROAD|N123456789|412345678|9876543210|okaxis|SBIN/)
  })

  it("a broken chain needs a check; a year of lines over many pages reads in full", async () => {
    const broken = await readStatementPdf(lib, syntheticPdf(pnbSavingsPages({ breakChainAt: 3 })))
    if (broken.status !== "ok") throw new Error(broken.status)
    expect(bankStatementNeedsCheck(parsePnbSavingsStatementText(broken.text))).toBe(true)

    const rows = Array.from({ length: 52 }, (_, week) => savingsDefaultRows(`2026-${String(1 + Math.floor(week / 5)).padStart(2, "0")}-${String(1 + (week % 5) * 5 + 6).padStart(2, "0")}`)).flat()
    const year = await readStatementPdf(lib, syntheticPdf(pnbSavingsPages({ rows })))
    if (year.status !== "ok") throw new Error(year.status)
    expect(year.pages).toBeGreaterThan(5)
    const parsed = parsePnbSavingsStatementText(year.text)
    expect(parsed.issues).toEqual([])
    expect(parsed.lines).toHaveLength(rows.length)
    expect(bankStatementNeedsCheck(parsed)).toBe(false)
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
