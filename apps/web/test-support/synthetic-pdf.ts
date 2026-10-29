// Synthetic statement PDFs for tests (Sprint 9a.3), written by hand so no PDF library or real
// statement is needed: text placed at given x / y on each page (Helvetica, a standard font),
// optionally protected with a user password (PDF Standard security handler, revision 3, 128-bit
// RC4), or with no text at all (only a drawn shape, as a scanned page has). Test use only.
import { createHash } from "node:crypto"

/** A cell at x on its row; `dy` moves it up (+) or down (-) from the row's baseline. */
export type SyntheticCell = { x: number; text: string; dy?: number }
export type SyntheticRow = SyntheticCell[]
export type SyntheticPage = SyntheticRow[]

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
])

const md5 = (...parts: Uint8Array[]) => {
  const h = createHash("md5")
  for (const p of parts) h.update(p)
  return new Uint8Array(h.digest())
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255
    ;[s[i], s[j]] = [s[j]!, s[i]!]
  }
  const out = new Uint8Array(data.length)
  let i = 0
  j = 0
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255
    j = (j + s[i]!) & 255
    ;[s[i], s[j]] = [s[j]!, s[i]!]
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 255]!
  }
  return out
}

const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 255)
const padded = (password: string) => {
  const out = new Uint8Array(32)
  const bytes = latin1(password).slice(0, 32)
  out.set(bytes)
  out.set(PAD.slice(0, 32 - bytes.length), bytes.length)
  return out
}
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex")
const xorKey = (key: Uint8Array, n: number) => key.map((b) => b ^ n)

/** Standard security handler, R3, 128-bit key: the /O and /U entries and the file key. */
function security(userPassword: string, ownerPassword: string, id: Uint8Array, permissions: number) {
  let h = md5(padded(ownerPassword))
  for (let i = 0; i < 50; i++) h = md5(h)
  const ownerKey = h.slice(0, 16)
  let o = rc4(ownerKey, padded(userPassword))
  for (let i = 1; i <= 19; i++) o = rc4(xorKey(ownerKey, i), o)

  const p = new Uint8Array(4)
  new DataView(p.buffer).setInt32(0, permissions, true)
  let k = md5(padded(userPassword), o, p, id)
  for (let i = 0; i < 50; i++) k = md5(k.slice(0, 16))
  const fileKey = k.slice(0, 16)

  let u = rc4(fileKey, md5(PAD, id))
  for (let i = 1; i <= 19; i++) u = rc4(xorKey(fileKey, i), u)
  const uFull = new Uint8Array(32)
  uFull.set(u)
  return { o, u: uFull, fileKey }
}

function objectKey(fileKey: Uint8Array, num: number, gen: number) {
  return md5(fileKey, Uint8Array.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255])).slice(0, 16)
}

const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`)

function contentStream(page: SyntheticPage, noText: boolean): string {
  if (noText) return "0.8 0.8 0.8 rg 40 500 500 250 re f 0 0 0 rg 60 700 300 12 re f\n"
  const lines = ["BT", "/F1 9 Tf"]
  page.forEach((row, r) => {
    for (const cell of row) lines.push(`1 0 0 1 ${cell.x} ${800 - r * 14 + (cell.dy ?? 0)} Tm (${escape(cell.text)}) Tj`)
  })
  lines.push("ET")
  return `${lines.join("\n")}\n`
}

/**
 * A PDF with the given pages. `password` protects it (anyone opening it needs that password);
 * `noText` draws shapes instead of text, as a scanned statement has no text layer.
 */
export function syntheticPdf(pages: readonly SyntheticPage[], options: { password?: string; noText?: boolean } = {}): Uint8Array {
  const id = md5(latin1(`synthetic-${pages.length}-${options.password ?? ""}-${options.noText ? 1 : 0}`))
  const sec = options.password === undefined ? null : security(options.password, "synthetic-owner", id, -4)

  // 1 catalog, 2 pages, 3 font, then a page and its content stream per page.
  const objects: (string | Uint8Array)[] = []
  const pageNums = pages.map((_, i) => 4 + i * 2)
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"
  objects[2] = `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
  pages.forEach((page, i) => {
    const num = pageNums[i]!
    objects[num] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${num + 1} 0 R >>`
    let data: Uint8Array = latin1(contentStream(page, options.noText === true))
    if (sec) data = rc4(objectKey(sec.fileKey, num + 1, 0), data)
    objects[num + 1] = data
  })
  const encryptNum = objects.length
  if (sec) objects[encryptNum] = `<< /Filter /Standard /V 2 /R 3 /Length 128 /P -4 /O <${hex(sec.o)}> /U <${hex(sec.u)}> >>`

  const chunks: Uint8Array[] = [latin1("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")]
  let offset = chunks[0]!.length
  const offsets: number[] = []
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes)
    offset += bytes.length
  }
  for (let num = 1; num < objects.length; num++) {
    const body = objects[num]
    if (body === undefined) continue
    offsets[num] = offset
    if (typeof body === "string") push(latin1(`${num} 0 obj\n${body}\nendobj\n`))
    else {
      push(latin1(`${num} 0 obj\n<< /Length ${body.length} >>\nstream\n`))
      push(body)
      push(latin1("\nendstream\nendobj\n"))
    }
  }
  const xrefAt = offset
  const size = objects.length
  const xref = ["xref", `0 ${size}`, "0000000000 65535 f "]
  for (let num = 1; num < size; num++) xref.push(`${String(offsets[num] ?? 0).padStart(10, "0")} 00000 n `)
  const trailer = `trailer\n<< /Size ${size} /Root 1 0 R /ID [<${hex(id)}> <${hex(id)}>]${sec ? ` /Encrypt ${encryptNum} 0 R` : ""} >>\nstartxref\n${xrefAt}\n%%EOF\n`
  push(latin1(`${xref.join("\n")}\n${trailer}`))

  const out = new Uint8Array(offset)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** Places each row's cells at fixed column x positions (left to right). */
export const columns = (xs: readonly number[], rows: readonly (readonly string[])[]): SyntheticPage =>
  rows.map((row) => row.map((text, i) => ({ x: xs[i] ?? xs[xs.length - 1]! + 60 * (i - xs.length + 1), text })).filter((c) => c.text !== ""))

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
/** "2026-10-15" -> "15-OCT-2026", as PNB prints dates. */
export const pnbDate = (iso: string) => `${iso.slice(8, 10)}-${MONTHS[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}`

/** The statement's Payment Due Date: 20 days after the invoice date (ISO). */
export function pnbDueDate(invoiceIso: string): string {
  const [y, m, d] = invoiceIso.split("-").map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + 20)).toISOString().slice(0, 10)
}

export type PnbStatementOptions = {
  /** Invoice (statement) date, ISO; default 2026-10-15. */
  invoiceDate?: string
  /** One date for every transaction line, ISO (each line keeps its own date otherwise). */
  lineDate?: string
  /** Printed Total Invoice Value; default the Dr lines' sum (2,334.00 plus any extra purchases). */
  invoiceTotal?: string
  /** Extra ₹100.00 purchases ("SHOP 1", "SHOP 2"...) on page 2; the totals include them. */
  extraPurchases?: number
  /**
   * The FRESH BASKET row as some real statements draw it (network column only): its details
   * wrapped over two lines ("FRESH BASKET" / "STORES BENGAL") and its cells at slightly different
   * heights, given as y offsets from the row's baseline; `overprint` draws the first details line
   * twice. A blank row follows it, as the wrap pushes the next row down.
   */
  wrapped?: { date: number; network: number; line1: number; line2: number; overprint?: boolean }
  /**
   * Where the Invoice Date and Payment Due Date values sit: "label-row" (default: a row of labels,
   * then a row of values), "beside" (each value after its label), "next-row" (each label, then its
   * value on the row below), "one-row" (both labels, then both dates, on one row) or "unreadable"
   * (the Invoice Date label with no value of its own: a text row with another date under it).
   */
  dateLayout?: "label-row" | "beside" | "next-row" | "one-row" | "unreadable"
  /** Another date earlier in the header block ("Statement generated on ..."), ISO. */
  headerDate?: string
}

const rupees = (minor: number) => (minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * A two-page PNB-style card statement (layout from the owner's description; invented person,
 * merchants and card digits), with or without the Network/Last 4 Digit column. Bill ₹2,334.00:
 * a ₹1,500 payment, ₹1,784 purchase, ₹500 late fee and ₹50 IGST.
 */
export function pnbStatementPages(network: boolean, options: PnbStatementOptions = {}): SyntheticPage[] {
  const invoice = pnbDate(options.invoiceDate ?? "2026-10-15")
  const due = pnbDate(pnbDueDate(options.invoiceDate ?? "2026-10-15"))
  const extra = options.extraPurchases ?? 0
  const purchases = rupees(233_400 + extra * 10_000)
  const on = (iso: string) => pnbDate(options.lineDate ?? iso)
  const amounts = columns([40, 160, 320], [["Total Amount Due", "Total Amount Due for Month", "Minimum Amount Due"], [purchases, purchases, "116.70"]])
  const dates: Record<NonNullable<PnbStatementOptions["dateLayout"]>, SyntheticPage> = {
    "label-row": columns([40, 120, 220, 320, 450], [
      ["Invoice Date", "Payment Due Date", "Total Amount Due", "Total Amount Due for Month", "Minimum Amount Due"],
      [invoice, due, purchases, purchases, "116.70"],
    ]),
    beside: [...columns([40, 130], [["Invoice Date", invoice], ["Payment Due Date", due]]), ...amounts],
    "next-row": [...columns([40], [["Invoice Date"], [invoice], ["Payment Due Date"], [due]]), ...amounts],
    "one-row": [...columns([40, 110, 230, 320], [["Invoice Date", "Payment Due Date", invoice, due]]), ...amounts],
    unreadable: [...columns([40, 130], [["Invoice Date"], [`Printed on ${pnbDate("2026-10-13")} for you`], ["Payment Due Date", due]]), ...amounts],
  }
  const top = [
    ...columns([40], [["PUNJAB NATIONAL BANK CREDIT CARD STATEMENT"], ["EXAMPLE PERSON"], ["Card Number 5555 XXXX XXXX 0042"]]),
    ...(options.headerDate ? columns([40], [[`Statement generated on ${pnbDate(options.headerDate)}`]]) : []),
    ...dates[options.dateLayout ?? "label-row"],
    ...columns([40, 140, 260, 340, 500], [
      ["Previous Balance", "Purchases and other charges", "Cash Advances", "Payments and Other Credits / Shadow Credits", ""],
      ["1,500.00", purchases, "0.00", "1,500.00", ""],
    ]),
  ]
  const xs = network ? [40, 110, 180, 260, 520] : [40, 110, 180, 520]
  const net = network ? ["RUPAY - 0042"] : []
  const header = ["Transaction Date", "Post Date", ...(network ? ["Network/Last 4 Digit"] : []), `Trnx Details From 16-SEP-2026 to ${invoice}`, "Amount in Rs"]
  const page1 = [
    ...top,
    ...columns(xs, [
      header,
      [on("2026-09-18"), on("2026-09-19"), ...net, "PAYMENT RECEIVED - THANK YOU", "1500.00 Cr"],
      ...(network && options.wrapped ? [] : [[on("2026-09-21"), on("2026-09-22"), ...net, "FRESH BASKET STORES BENGAL", "1784.00 Dr"]]),
    ]),
    ...columns([40], [[`Date: ${invoice} Page 1`]]),
  ]
  if (network && options.wrapped) {
    const w = options.wrapped
    const row: SyntheticRow = [
      { x: 40, text: on("2026-09-21"), dy: w.date },
      { x: 110, text: on("2026-09-22"), dy: w.date },
      { x: 180, text: "RUPAY - 0042", dy: w.network },
      { x: 260, text: "FRESH BASKET", dy: w.line1 },
      ...(w.overprint ? [{ x: 260, text: "FRESH BASKET", dy: w.line1 }] : []),
      { x: 260, text: "STORES BENGAL", dy: w.line2 },
      { x: 520, text: "1784.00 Dr", dy: w.date },
    ]
    page1.splice(page1.length - 1, 0, row, [])
  }
  // Page 2: no repeated header.
  const page2 = [
    ...columns(xs, [
      [on("2026-10-10"), on("2026-10-10"), ...net, "LATE PAYMENT FEE", "500.00 Dr"],
      [on("2026-10-10"), on("2026-10-10"), ...net, "IGST @18% ON LATE PAYMENT FEE", "50.00 Dr"],
      ...Array.from({ length: extra }, (_, i) => [on("2026-10-11"), on("2026-10-11"), ...net, `SHOP ${i + 1}`, "100.00 Dr"]),
    ]),
    ...columns([40, 200], [["Total GST", "50.00"], ["Total Invoice Value", options.invoiceTotal ?? purchases], ["End of Statement", ""]]),
    ...columns([40], [[`Date: ${invoice} Page 2`]]),
  ]
  return [page1, page2]
}

/**
 * A one-page PNB card statement in the layout of the owner's real statement (described in text;
 * invented values): top-block labels with each value in a box to the right, a little off the
 * label's baseline; summary boxes with labels above whole-rupee or paise values; table rows of
 * Transaction Date, Post Date, "RUPAY -" and the last 4 digits as two pieces (one row in the other
 * order), details as printed and an amount with no marker for a debit and Cr for a credit; then
 * label-only totals, a Total Invoice Value drawn far right, stray "0" values over an advert, a
 * chart legend and legal text. 2 debits (₹1,784 and ₹500.64) and a ₹1,500 Cr payment; bill ₹2,284.64.
 */
export function pnbRealLayoutPages(options: { invoiceDate?: string; lineDate?: string } = {}): SyntheticPage[] {
  const invoiceIso = options.invoiceDate ?? "2026-09-20"
  const invoice = pnbDate(invoiceIso)
  const due = pnbDate(pnbDueDate(invoiceIso))
  const on = (iso: string) => pnbDate(options.lineDate ?? iso)
  const boxed = (label: string, value: string): SyntheticRow => [{ x: 40, text: label }, { x: 300, text: value, dy: -2 }]
  return [
    [
      [{ x: 40, text: "PUNJAB NATIONAL BANK" }],
      boxed("Invoice No", "INV12345678"),
      boxed("Card No", "5555 XXXX XXXX 0042"),
      boxed("Invoice Date", invoice),
      boxed("Payment Due Date", due),
      boxed("Total Amount Due", "2,284.64"),
      boxed("Total Amount Due for Month", "2,284.64"),
      boxed("Minimum Amount Due", "114.23"),
      [],
      ...columns([40, 140, 260, 340], [
        ["Previous Balance", "Purchases and other charges", "Cash Advances", "Payments and Other Credits / Shadow Credits"],
        ["1500", "2284.64", "0", "1500"],
      ]),
      [],
      ...columns([40, 110, 180, 260, 520], [["Transaction Date", "Post Date", "Network/Last 4 Digit", "Trnx Details", "Amount in Rs"]]),
      [
        { x: 40, text: on("2026-08-25") }, { x: 110, text: on("2026-08-26") },
        { x: 180, text: "RUPAY -" }, { x: 218, text: "0042" },
        { x: 260, text: "PAYMENT RECEIVED BBPS" }, { x: 520, text: "1,500.00 Cr" },
      ],
      [
        { x: 40, text: on("2026-08-28") }, { x: 110, text: on("2026-08-29") },
        { x: 180, text: "RUPAY -", dy: 1 }, { x: 218, text: "0042", dy: -1 },
        { x: 260, text: "FRESH BASKET STORES KOLKATA IN" }, { x: 520, text: "1,784.00" },
      ],
      [
        { x: 40, text: on("2026-09-02") }, { x: 110, text: on("2026-09-03") },
        { x: 180, text: "0042" }, { x: 205, text: "RUPAY -" },
        { x: 260, text: "CITYFUEL POINT HOWRAH IN" }, { x: 520, text: "500.64" },
      ],
      [],
      [{ x: 40, text: "Total Purchase" }],
      [{ x: 40, text: "Total Taxable Value" }],
      [{ x: 40, text: "Total GST" }],
      [{ x: 40, text: "Total Charges Reversed" }],
      [{ x: 40, text: "Total GST Reversed" }],
      [{ x: 40, text: "Total Invoice Value" }, { x: 540, text: "2,284.64", dy: 1 }],
      [],
      [{ x: 300, text: "0" }, { x: 360, text: "0" }],
      [{ x: 300, text: "SPEND MORE, EARN MORE REWARDS" }],
      [{ x: 40, text: "Shopping 78%" }, { x: 140, text: "Fuel 22%" }],
      [{ x: 40, text: "This is a system generated statement. Terms and conditions apply." }],
      [{ x: 40, text: "End of Statement" }],
    ],
  ]
}

const slashDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/**
 * A one-page card statement from a bank with no reader of its own (invented layout and values),
 * that verifies itself: its summary beside the labels adds up to the total due, and its debit lines
 * add up to the purchases (₹1,784 + ₹500 + ₹50 = ₹2,334, after a ₹1,500 Cr payment).
 * `balanced: false` prints a total that doesn't add up, so it doesn't verify itself.
 */
export function genericStatementPages(options: { statementDate?: string; lineDate?: string; balanced?: boolean } = {}): SyntheticPage[] {
  const statement = options.statementDate ?? "2026-10-15"
  const on = (iso: string) => slashDate(options.lineDate ?? iso)
  return [
    columns([40, 260], [
      ["EXAMPLE BANK CREDIT CARD STATEMENT", ""],
      ["Statement Date", slashDate(statement)],
      ["Payment Due Date", slashDate(pnbDueDate(statement))],
      ["Total Amount Due", options.balanced === false ? "2,434.00" : "2,334.00"],
      ["Minimum Amount Due", "116.70"],
      ["Previous Balance", "1,500.00"],
      ["Purchases & Other Charges", "2,334.00"],
      ["Payments & Credits", "1,500.00 Cr"],
    ]).concat(
      columns([40, 120, 520], [
        [on("2026-09-18"), "PAYMENT RECEIVED THANK YOU", "1,500.00 Cr"],
        [on("2026-09-21"), "FRESH BASKET STORES", "1,784.00"],
        [on("2026-10-10"), "LATE PAYMENT FEE", "500.00"],
        [on("2026-10-10"), "IGST ON LATE PAYMENT FEE", "50.00"],
      ]),
    ),
  ]
}
