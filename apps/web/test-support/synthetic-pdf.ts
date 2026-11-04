// Synthetic statement PDFs for tests (Sprint 9a.3), written by hand so no PDF library or real
// statement is needed: text placed at given x / y on each page (Helvetica, a standard font),
// optionally protected with a user password (PDF Standard security handler, revision 3, 128-bit
// RC4), or with no text at all (only a drawn shape, as a scanned page has). Test use only.
import { createHash } from "node:crypto"

/** A cell at x on its row; `dy` moves it up (+) or down (-) from the row's baseline; `size` in points (default 9). */
export type SyntheticCell = { x: number; text: string; dy?: number; size?: number }
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
  let size = 9
  page.forEach((row, r) => {
    for (const cell of row) {
      if ((cell.size ?? 9) !== size) lines.push(`/F1 ${(size = cell.size ?? 9)} Tf`)
      lines.push(`1 0 0 1 ${cell.x} ${800 - r * 14 + (cell.dy ?? 0)} Tm (${escape(cell.text)}) Tj`)
    }
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
  /** A dated row with no amount on page 2 ("MYSTERY MERCHANT"), which the reader can't use. */
  unreadableRow?: boolean
  /** A refund on page 2 ("REFUND FRESH BASKET STORES", Cr), in minor units: counted in the payments and credits box and off the amount due. */
  refundMinor?: number
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
  const refund = options.refundMinor ?? 0
  // The amount due: the previous ₹1,500 is paid, so purchases less any refund.
  const owed = rupees(233_400 + extra * 10_000 - refund)
  const on = (iso: string) => pnbDate(options.lineDate ?? iso)
  const amounts = columns([40, 160, 320], [["Total Amount Due", "Total Amount Due for Month", "Minimum Amount Due"], [owed, owed, "116.70"]])
  const dates: Record<NonNullable<PnbStatementOptions["dateLayout"]>, SyntheticPage> = {
    "label-row": columns([40, 120, 220, 320, 450], [
      ["Invoice Date", "Payment Due Date", "Total Amount Due", "Total Amount Due for Month", "Minimum Amount Due"],
      [invoice, due, owed, owed, "116.70"],
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
      ["1,500.00", purchases, "0.00", rupees(150_000 + refund), ""],
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
      ...(options.unreadableRow ? [[on("2026-10-12"), on("2026-10-12"), ...net, "MYSTERY MERCHANT", ""]] : []),
      ...(refund > 0 ? [[on("2026-10-13"), on("2026-10-13"), ...net, "REFUND FRESH BASKET STORES", `${(refund / 100).toFixed(2)} Cr`]] : []),
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
 *
 * `smallPrint` adds two rows in the exact shapes of two rows of the owner's real statement (from
 * its masked "Copy layout"; invented text): table cells at x 20 / 80 / 130 / 200 / ~355 in ~6.8pt
 * type, a ₹5,046.64 debit and a ₹1,500.00 payment with its Cr as a piece of its own, each with
 * ~1.8pt small print beside it (x ~424 and ~560) a few points off its baseline. Bill ₹5,831.28.
 */
export function pnbRealLayoutPages(options: { invoiceDate?: string; lineDate?: string; smallPrint?: boolean } = {}): SyntheticPage[] {
  const small = options.smallPrint === true
  const purchases = small ? "7331.28" : "2284.64"
  const totalDue = small ? "5,831.28" : "2,284.64"
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
      boxed("Total Amount Due", totalDue),
      boxed("Total Amount Due for Month", totalDue),
      boxed("Minimum Amount Due", small ? "291.56" : "114.23"),
      [],
      ...columns([40, 140, 260, 340], [
        ["Previous Balance", "Purchases and other charges", "Cash Advances", "Payments and Other Credits / Shadow Credits"],
        ["1500", purchases, "0", small ? "3000" : "1500"],
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
      ...(small
        ? [
            [],
            [
              { x: 20, text: on("2026-09-08"), size: 6.8 }, { x: 80, text: on("2026-09-09"), size: 6.8 },
              { x: 130, text: "RUPAY - 0042", size: 6.8 }, { x: 200, text: "SKYLINE TRAVELS ONLINE BOOKINGS IND", size: 6.8 },
              { x: 357, text: "5046.64", size: 6.8 },
              { x: 424, text: "POINTS EARNED", dy: -4, size: 1.8 }, { x: 425, text: "POINTS CREDIT", dy: -7, size: 1.8 },
              { x: 562, text: "POINTS OPENED", dy: -4, size: 1.8 }, { x: 562, text: "POINTS EXPIRE", dy: -7, size: 1.8 },
            ],
            [
              { x: 20, text: on("2026-09-10"), dy: -3, size: 6.8 }, { x: 80, text: on("2026-09-10"), dy: -3, size: 6.8 },
              { x: 130, text: "RUPAY - 0042", dy: -3, size: 6.8 }, { x: 200, text: "PAYMENT RECEIVED THANKYOU", dy: -3, size: 6.8 },
              { x: 354, text: "1,500.00", dy: -3, size: 6.8 }, { x: 392, text: "Cr", dy: -3, size: 6.8 },
              { x: 421, text: "REWARD POINTS BALANCE", size: 1.8 }, { x: 558, text: "REDEEM AT THE STORE", size: 1.8 },
            ],
          ]
        : []),
      [],
      [{ x: 40, text: "Total Purchase" }],
      [{ x: 40, text: "Total Taxable Value" }],
      [{ x: 40, text: "Total GST" }],
      [{ x: 40, text: "Total Charges Reversed" }],
      [{ x: 40, text: "Total GST Reversed" }],
      [{ x: 40, text: "Total Invoice Value" }, { x: 540, text: small ? "7,331.28" : "2,284.64", dy: 1 }],
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

/** One line of a synthetic bank statement; `remarks` is printed one piece per row (a wrapped cell). */
export type SavingsRow = { date: string; amountMinor: number; direction: "DR" | "CR"; remarks: string[]; instrument?: string }

const plain = (minor: number) => `${Math.trunc(minor / 100)}.${String(Math.abs(minor) % 100).padStart(2, "0")}`

/** ISO date `days` before `iso`. */
export const isoDaysBefore = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10)
}

/**
 * Seven lines of an invented savings account, oldest first, the newest on `end`: salary (CR),
 * a UPI purchase, a UPI payment to a person with its remarks wrapped over two rows, a transfer to
 * another own account, a UPI credit from the same person, a card payment, and the same person paid
 * again. Opening ₹25,000.00; closing ₹65,384.00.
 */
export function savingsDefaultRows(end = "2026-10-28"): SavingsRow[] {
  const on = (days: number) => isoDaysBefore(end, days)
  return [
    { date: on(6), amountMinor: 5_000_000, direction: "CR", remarks: ["NEFT/SALARY OCT/EXAMPLE EMPLOYER PVT LTD"], instrument: "N123456789" },
    { date: on(5), amountMinor: 178_400, direction: "DR", remarks: ["UPI/DR/412345678901/FRESH BASKET/HDFC/freshbasket@okhdfc"] },
    { date: on(4), amountMinor: 64_900, direction: "DR", remarks: ["UPI/DR/412345678902/RAVI KUMAR/SBIN/", "ravi9876543210@okaxis"] },
    { date: on(3), amountMinor: 500_000, direction: "DR", remarks: ["IMPS/TRANSFER TO OWN ACCOUNT"] },
    { date: on(2), amountMinor: 120_000, direction: "CR", remarks: ["UPI/CR/412345678903/RAVI KUMAR/SBIN/ravi9876543210@okaxis"] },
    { date: on(1), amountMinor: 233_400, direction: "DR", remarks: ["CARD PAYMENT PNB RUPAY"] },
    { date: on(0), amountMinor: 64_900, direction: "DR", remarks: ["UPI/DR/412345678904/RAVI KUMAR/SBIN/ravi9876543210@okaxis"] },
  ]
}

/**
 * A PNB savings account statement (layout from the owner's description; invented person, account
 * number, address and values): a header block that must never be kept, the column header row
 * (Date, Instrument ID, Amount, Type, Balance, Remarks), lines newest first with amounts printed
 * without commas and balances with them, remarks wrapped one piece per row, then the opening and
 * closing balances and a page footer. 50 lines a page; the column header repeats on each page.
 * `breakChainAt`: the balance printed on that line (index oldest first) is ₹1 off. `summary: false`
 * leaves out the opening and closing balances.
 */
export function pnbSavingsPages(
  options: { rows?: SavingsRow[]; openingMinor?: number; breakChainAt?: number; summary?: boolean } = {},
): SyntheticPage[] {
  const rows = options.rows ?? savingsDefaultRows()
  const opening = options.openingMinor ?? 2_500_000
  let balance = opening
  const printed = rows.map((row, i) => {
    balance += row.direction === "CR" ? row.amountMinor : -row.amountMinor
    return { row, balance: balance + (i === options.breakChainAt ? 100 : 0) }
  })
  const xs = [40, 100, 180, 240, 280, 360]
  const header = columns(xs, [["Date", "Instrument ID", "Amount", "Type", "Balance", "Remarks"]])
  const lineRows = printed.reverse().flatMap(({ row, balance: b }): SyntheticPage => [
    columns(xs, [[slashDate(row.date), row.instrument ?? "", plain(row.amountMinor), row.direction, rupees(b), row.remarks[0] ?? ""]])[0]!,
    ...row.remarks.slice(1).map((piece) => [{ x: 360, text: piece }]),
  ])
  const pages: SyntheticPage[] = []
  for (let i = 0; i < Math.max(1, lineRows.length); i += 50) pages.push([...header, ...lineRows.slice(i, i + 50)])
  pages[0]!.unshift(
    [{ x: 40, text: "PUNJAB NATIONAL BANK" }],
    [{ x: 40, text: "Account Statement" }],
    [{ x: 40, text: "Account No" }, { x: 160, text: "0000111122223333" }],
    [{ x: 40, text: "Customer Name" }, { x: 160, text: "EXAMPLE PERSON" }],
    [{ x: 40, text: "Address" }, { x: 160, text: "1 EXAMPLE ROAD, KOLKATA 700001" }],
    [],
  )
  const last = pages[pages.length - 1]!
  if (options.summary !== false) last.push([], [{ x: 40, text: "Opening Balance" }, { x: 180, text: rupees(opening) }], [{ x: 40, text: "Closing Balance" }, { x: 180, text: rupees(balance) }])
  pages.forEach((page, i) => page.push([{ x: 40, text: `Date: 30/10/2026 Page ${i + 1}` }]))
  return pages
}

/** Lines for separateColumnsPages, oldest first, the newest on `end`; remarks at most two short pieces. */
export function separateColumnsDefaultRows(end = "2026-10-28"): SavingsRow[] {
  const on = (days: number) => isoDaysBefore(end, days)
  return [
    { date: on(6), amountMinor: 5_000_000, direction: "CR", remarks: ["NEFT CR-EXAMPLE EMPLOYER", "SALARY OCT"], instrument: "N27526001" },
    { date: on(5), amountMinor: 178_400, direction: "DR", remarks: ["UPI-FRESH BASKET"], instrument: "REF000111" },
    { date: on(4), amountMinor: 64_900, direction: "DR", remarks: ["UPI-RAVI KUMAR"], instrument: "REF000112" },
    { date: on(3), amountMinor: 500_000, direction: "DR", remarks: ["IMPS-OWN ACCOUNT"], instrument: "REF000113" },
    { date: on(2), amountMinor: 120_000, direction: "CR", remarks: ["UPI-RAVI KUMAR REFUND"], instrument: "REF000114" },
    { date: on(1), amountMinor: 233_400, direction: "DR", remarks: ["CARD PAYMENT"], instrument: "REF000115" },
    { date: on(0), amountMinor: 64_900, direction: "DR", remarks: ["UPI-RAVI KUMAR"], instrument: "REF000116" },
  ]
}

/**
 * A savings statement from a bank with no reader of its own (Sprint 9d; invented layout, person,
 * account number and values): a header block that must never be kept, then Date, Narration,
 * Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt., Closing Balance; lines oldest first with
 * DD/MM/YY dates and one of the two amount cells empty, a narration wrapped onto a second row,
 * 30 lines a page with the header repeated and a "Page n of m" footer, and the summary printed
 * as a row of labels with its values below. `breakChainAt`: the balance printed on that line
 * (index oldest first) is ₹1 off.
 */
export function separateColumnsPages(options: { rows?: SavingsRow[]; openingMinor?: number; breakChainAt?: number } = {}): SyntheticPage[] {
  const rows = options.rows ?? separateColumnsDefaultRows()
  const opening = options.openingMinor ?? 2_500_000
  const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`
  const xs = [30, 85, 235, 300, 350, 430, 505]
  const header = columns(xs, [["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"]])
  let balance = opening
  let debits = 0
  let credits = 0
  const lineRows = rows.flatMap((row, i): SyntheticPage => {
    balance += row.direction === "CR" ? row.amountMinor : -row.amountMinor
    if (row.direction === "CR") credits += row.amountMinor
    else debits += row.amountMinor
    const printed = balance + (i === options.breakChainAt ? 100 : 0)
    const debit = row.direction === "DR" ? rupees(row.amountMinor) : ""
    const credit = row.direction === "CR" ? rupees(row.amountMinor) : ""
    return [
      columns(xs, [[shortDate(row.date), row.remarks[0] ?? "", row.instrument ?? "", shortDate(row.date), debit, credit, rupees(printed)]])[0]!,
      ...row.remarks.slice(1).map((piece) => [{ x: 85, text: piece }]),
    ]
  })
  const pages: SyntheticPage[] = []
  for (let i = 0; i < Math.max(1, lineRows.length); i += 30) pages.push([...header, ...lineRows.slice(i, i + 30)])
  pages[0]!.unshift(
    [{ x: 30, text: "EXAMPLE BANK LIMITED" }],
    [{ x: 30, text: "Account No" }, { x: 160, text: "50100012345678" }],
    [{ x: 30, text: "Customer Name" }, { x: 160, text: "EXAMPLE PERSON" }],
    [],
  )
  const dr = rows.filter((r) => r.direction === "DR").length
  pages[pages.length - 1]!.push(
    [],
    [{ x: 30, text: "STATEMENT SUMMARY" }],
    columns([30, 120, 190, 260, 350, 440], [["Opening Balance", "Dr Count", "Cr Count", "Debits", "Credits", "Closing Bal"]])[0]!,
    columns([30, 120, 190, 260, 350, 440], [[rupees(opening), String(dr), String(rows.length - dr), rupees(debits), rupees(credits), rupees(balance)]])[0]!,
  )
  pages.forEach((page, i) => page.push([], [{ x: 280, text: `Page ${i + 1} of ${pages.length}` }]))
  return pages
}
