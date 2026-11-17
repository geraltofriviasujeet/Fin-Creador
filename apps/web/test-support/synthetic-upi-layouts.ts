// Synthetic Paytm, PhonePe and BHIM statements with the word positions of the owner's real ones
// (Sprint 9e, from masked pdftotext -bbox layouts: positions and structural words only). Every
// name, number, reference and amount here is invented. Positions are pdftotext's: x from the left,
// `top` from the top of the page, both in points.
//   Paytm: a summary page (totals, payment counts, every account in full), then one block per
//   payment. The date and amount sit 3 points above the "Paid to" row in some blocks and on it in
//   others; the account label wraps down its column over up to three rows, its digits on a later
//   row ("HDFC Bank -" / "00"; "Punjab" / "National" / "Bank - 66"; "State Bank" / "Of India - 65").
//   PhonePe: amounts of 10,000 or more print "INR" on the block's first row and the number on the
//   next, at the same x; some payees are a masked number.
//   BHIM: one wide table row per payment, with Pay/Collect, DR/CR and a status column.
import type { SyntheticPage } from "./synthetic-pdf"

type Placed = { x: number; top: number; text: string; size?: number }

/** One page from placed words: pdftotext's top-down `top` becomes the PDF's baseline, 800 - top (portrait) or 585 - top (landscape: syntheticPdf's `landscape`). */
const page = (items: readonly Placed[], size = 10, landscape = false): SyntheticPage => [
  items.map((i) => ({ x: i.x, text: i.text, dy: -i.top - (landscape ? 215 : 0), size: i.size ?? size })),
]

const NAMES = ["Green Leaf Cafe", "Corner Store", "Ravi Kumar", "Meera N", "Sunrise Medicals", "City Cabs", "Lakeview Grocers", "Blue Door Bakery", "Om Sai Traders", "Pixel Mobiles"]
const rupees = (minor: number) => `Rs.${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: minor % 100 === 0 ? 0 : 2 })}`
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Exactly `count` of `total` indexes, spread evenly. */
const spread = (i: number, count: number, total: number) => Math.floor(((i + 1) * count) / total) > Math.floor((i * count) / total)

/** Newest first, from 15 Nov 2026 back to 1 Oct 2026. */
function dayOf(i: number, total: number): { day: number; month: number } {
  const back = Math.floor((i * 46) / total)
  return back < 15 ? { day: 15 - back, month: 11 } : { day: 31 - (back - 15), month: 10 }
}

export type PaytmBank = "hdfc" | "pnb" | "sbi" | "canara"
export const PAYTM_ACCOUNTS: Record<PaytmBank, { label: string; digits: string }> = {
  hdfc: { label: "HDFC Bank", digits: "00" },
  pnb: { label: "Punjab National Bank", digits: "66" },
  sbi: { label: "State Bank Of India", digits: "65" },
  canara: { label: "Canara Bank", digits: "22" },
}

export type PaytmLayoutPayment = {
  i: number
  bank: PaytmBank
  kind: "Paid to" | "Money sent to" | "Received from"
  name: string
  minor: number
  /** The date and amount 3 points above the "Paid to" row (else on it). */
  raised: boolean
  ref: string
  date: string
  tag: string
  note: boolean
  /** The payee name wraps onto a row of its own below the UPI ID. */
  wrappedName: boolean
  /** One of the five odd blocks (PAYTM_ODD_BLOCKS), laid out as it is; else null. */
  odd: number | null
}

/** The owner's counts: 300 paid (HDFC 146, PNB 71, SBI 61, Canara 22) and 13 received (Canara); 161 blocks raised; five odd blocks (2 PNB, 3 HDFC). */
export function paytmLayoutPayments(): PaytmLayoutPayment[] {
  const banks: { bank: PaytmBank; received: boolean }[] = []
  const add = (bank: PaytmBank, n: number, received = false) => {
    for (let k = 0; k < n; k++) banks.push({ bank, received })
  }
  add("hdfc", 146)
  add("pnb", 71)
  add("sbi", 61)
  add("canara", 22)
  add("canara", 13, true)
  const total = banks.length
  // A fixed shuffle (97 is coprime with 313) so banks and layouts mix on every page.
  const payments = banks.map((_, i): PaytmLayoutPayment => {
    const { bank, received } = banks[(i * 97) % total]!
    const { day, month } = dayOf(i, total)
    const sent = !received && bank === "hdfc" && i % 9 === 0
    const minor = received ? 50_000 + i * 1_300 : i % 41 === 0 ? 1_234_500 + i * 100 : (10 + ((i * 37) % 1_990)) * 100 + (i % 5 === 0 ? 50 : 0)
    return {
      i,
      bank,
      kind: received ? "Received from" : sent ? "Money sent to" : "Paid to",
      name: NAMES[i % NAMES.length]!,
      minor,
      raised: spread(i, 161, total),
      ref: String(512_300_000_000 + i),
      date: `${String(day).padStart(2, "0")} ${MONTHS[month - 1]}`,
      tag: received ? "Money Received" : sent ? "Money Transfer" : ["Food", "Shopping", "Miscellaneous", "Groceries", "Taxi"][i % 5]!,
      note: bank === "hdfc" && !received && i % 7 === 3,
      wrappedName: bank === "sbi" && i % 3 === 0,
      odd: null,
    }
  })
  // The odd blocks replace plain "Paid to" blocks of their bank, spread through the file.
  PAYTM_ODD_BLOCKS.forEach((odd, k) => {
    const plain = payments.filter((p) => p.bank === odd.bank && p.kind === "Paid to" && !p.note && p.odd === null)
    const p = plain[Math.floor(((k + 1) * plain.length) / 7)]!
    Object.assign(p, { odd: k, name: odd.name, tag: odd.tag })
  })
  return payments
}

type OddRow = [top: number, words: [x: number, text: string][]]

/**
 * The five blocks of the owner's file that differ from the rest, word by word at their masked x
 * and row offsets (pdftotext's top, from the block's first row); every word invented. Each has a
 * note that runs down the notes column (x 288) over several rows, and "Tag:" and "# <tag>" pushed
 * down to its last rows. 0, 2 and 4: the UPI ID wraps ("UPI ID: <first part>." then the rest
 * alone at x 91). 0: the payee name wraps ("... Services Private" then "Limited"). 3: a word alone
 * at x 91 below the UPI ID, as a wrapped name. DATE, TIME, AMOUNT and REF are the payment's own.
 */
export const PAYTM_ODD_BLOCKS: { bank: PaytmBank; name: string; payee: string; tag: string; rows: OddRow[] }[] = [
  {
    bank: "pnb", name: "Kiran Services Private", payee: "Kiran Services Private Limited", tag: "Services",
    rows: [
      [0, [[22, "DAY"], [36, "MON"], [91, "Paid"], [113, "to"], [124, "Kiran"], [167, "Services"], [208, "Private"], [288, "Note:"], [315, "Payment"], [358, "for"], [413, "Punjab"], [491, "-"], [497, "AMOUNT"]]],
      [12, [[22, "TIME"], [51, "AM"]]],
      [15, [[91, "Limited"], [288, "rent"]]],
      [18, [[413, "National"]]],
      [30, [[288, "Sharma…"]]],
      [33, [[91, "UPI"], [108, "ID:"], [124, "kiranservice12345."], [413, "Bank"], [439, "-"], [445, "66"]]],
      [42, [[288, "Kumar"]]],
      [48, [[91, "rzp@icici"]]],
      [60, [[91, "UPI"], [108, "Ref"], [126, "No:"], [144, "REF"], [302, "Tag:"]]],
      [78, [[294, "#"], [302, "Services"]]],
    ],
  },
  {
    bank: "pnb", name: "Mehta…", payee: "Mehta…", tag: "Medical",
    rows: [
      [0, [[22, "DAY"], [36, "MON"], [491, "-"], [497, "AMOUNT"]]],
      [3, [[91, "Paid"], [113, "to"], [124, "Mehta…"], [288, "Note:"], [315, "Payment"], [358, "for"], [413, "Punjab"]]],
      [12, [[22, "TIME"], [45, "PM"]]],
      [15, [[288, "UPI"], [305, "bill"]]],
      [18, [[413, "National"]]],
      [21, [[91, "UPI"], [108, "ID:"], [124, "mehta.care@okaxis"], [236, "on"]]],
      [33, [[302, "Tag:"]]],
      [36, [[413, "Bank"], [439, "-"], [445, "66"]]],
      [48, [[91, "UPI"], [108, "Ref"], [126, "No:"], [144, "REF"]]],
      [51, [[294, "#"], [302, "Medical"]]],
    ],
  },
  {
    bank: "hdfc", name: "Ravi", payee: "Ravi", tag: "Taxi",
    rows: [
      [0, [[22, "DAY"], [36, "MON"], [491, "-"], [497, "AMOUNT"]]],
      [3, [[91, "Paid"], [113, "to"], [124, "Ravi"], [288, "Note:"], [315, "Go"], [334, "to"], [413, "HDFC"], [441, "Bank"], [467, "-"]]],
      [12, [[22, "TIME"], [45, "PM"]]],
      [15, [[288, "Airport…"]]],
      [18, [[413, "00"]]],
      [21, [[91, "UPI"], [108, "ID:"], [124, "cabsride."]]],
      [33, [[91, "pay@axisbank"], [302, "Tag:"]]],
      [48, [[91, "UPI"], [108, "Ref"], [126, "No:"], [144, "REF"]]],
      [51, [[294, "#"], [302, "Taxi"]]],
    ],
  },
  {
    bank: "hdfc", name: "Gupta…", payee: "Gupta… Stores", tag: "Miscellaneous",
    rows: [
      [0, [[22, "DAY"], [36, "MON"], [288, "Note:"], [315, "Spares…"], [491, "-"], [497, "AMOUNT"]]],
      [3, [[91, "Paid"], [113, "to"], [124, "Gupta…"], [413, "HDFC"], [441, "Bank"], [467, "-"]]],
      [12, [[22, "TIME"], [45, "PM"]]],
      [15, [[288, "Bolts…"]]],
      [18, [[91, "UPI"], [108, "ID:"], [124, "gupta.store@ybl"], [413, "00"]]],
      [30, [[288, "Paint"]]],
      [33, [[91, "Stores"]]],
      [48, [[91, "UPI"], [108, "Ref"], [126, "No:"], [144, "REF"], [302, "Tag:"]]],
      [63, [[294, "#"], [302, "Miscellaneous"]]],
    ],
  },
  {
    bank: "hdfc", name: "Arun", payee: "Arun", tag: "Taxi",
    rows: [
      [0, [[22, "DAY"], [36, "MON"], [491, "-"], [497, "AMOUNT"]]],
      [3, [[91, "Paid"], [113, "to"], [124, "Arun"], [288, "Note:"], [315, "Go"], [334, "to"], [413, "HDFC"], [441, "Bank"], [467, "-"]]],
      [12, [[22, "TIME"], [45, "PM"]]],
      [15, [[288, "Station…"]]],
      [18, [[413, "00"]]],
      [21, [[91, "UPI"], [108, "ID:"], [124, "autoride."]]],
      [33, [[91, "pay@okicici"], [302, "Tag:"]]],
      [48, [[91, "UPI"], [108, "Ref"], [126, "No:"], [144, "REF"]]],
      [51, [[294, "#"], [302, "Taxi"]]],
    ],
  },
]

/** An odd block's words, the payment's own date, time, amount and reference put in; the next block 36 points below its last row. */
function paytmOddBlock(p: PaytmLayoutPayment): { items: Placed[]; height: number } {
  const [day, mon] = p.date.split(" ")
  const fill: Record<string, string> = { DAY: day!, MON: mon!, TIME: `${(p.i % 12) + 1}:${String(p.i % 60).padStart(2, "0")}`, AMOUNT: rupees(p.minor), REF: p.ref }
  const rows = PAYTM_ODD_BLOCKS[p.odd!]!.rows
  return {
    items: rows.flatMap(([top, words]) => words.map(([x, text]) => ({ x, top, text: fill[text] ?? text }))),
    height: rows.at(-1)![0] + 36,
  }
}

/** A Paytm block's words, `top` relative to the block's first row; and the block's height. */
function paytmBlock(p: PaytmLayoutPayment): { items: Placed[]; height: number } {
  if (p.odd !== null) return paytmOddBlock(p)
  const a = p.raised ? 3 : 0
  const items: Placed[] = [
    { x: 22, top: 0, text: p.date },
    { x: 491, top: 0, text: `${p.kind === "Received from" ? "+" : "-"} ${rupees(p.minor)}` },
    { x: 91, top: a, text: `${p.kind} ${p.name}` },
    { x: 22, top: 12 + (p.i % 2) * 3, text: `${(p.i % 12) + 1}:${String(p.i % 60).padStart(2, "0")} PM` },
  ]
  // The account column, as each bank's label wraps.
  if (p.bank === "hdfc") items.push({ x: 413, top: a, text: "HDFC Bank -" }, { x: 413, top: 18, text: "00" })
  if (p.bank === "pnb") items.push({ x: 413, top: a, text: "Punjab" }, { x: 413, top: 18, text: "National" }, { x: 413, top: 33, text: "Bank - 66" })
  if (p.bank === "sbi") items.push({ x: 413, top: a, text: "State Bank" }, { x: 413, top: 18, text: "Of India - 65" })
  if (p.bank === "canara") items.push({ x: 413, top: a, text: "Canara Bank" }, { x: 413, top: 18, text: "- 22" })
  // Notes and tags: "Tag:" on the first rows, "# <tag>" lower down; a note takes the tag's place on the first row.
  if (p.note) items.push({ x: 294, top: a, text: "Note: UPIIntent" }, { x: 302, top: 15, text: "Tag:" }, { x: 294, top: 18, text: `# ${p.tag}` })
  else if (p.bank === "sbi") items.push({ x: 302, top: 0, text: "Tag:" }, { x: 294, top: 18, text: `# ${p.tag}` })
  else items.push({ x: 302, top: a, text: "Tag:" }, { x: 294, top: 18 + (p.raised ? 3 : 0), text: `# ${p.tag}` })
  const idTop = p.raised ? 21 : 18
  items.push({ x: 91, top: idTop, text: `UPI ID: payee${p.i}@okexample on` })
  const refTop = p.wrappedName ? idTop + 30 : idTop + 15
  if (p.wrappedName) items.push({ x: 91, top: idTop + 15, text: "Traders" })
  items.push({ x: 91, top: refTop, text: `UPI Ref No: ${p.ref}` })
  return { items, height: Math.max(refTop, 33) + 48 }
}

/** The payee name as the reader should keep it. */
export const paytmLayoutPayee = (p: PaytmLayoutPayment) => (p.odd !== null ? PAYTM_ODD_BLOCKS[p.odd]!.payee : p.wrappedName ? `${p.name} Traders` : p.name)

/** `drop`: payments the summary counts but whose blocks are left out (a short read). */
export function paytmLayoutPages(payments: PaytmLayoutPayment[] = paytmLayoutPayments(), drop: ReadonlySet<number> = new Set()): SyntheticPage[] {
  const paid = payments.filter((p) => p.kind !== "Received from")
  const received = payments.filter((p) => p.kind === "Received from")
  const sum = (ps: PaytmLayoutPayment[]) => ps.reduce((s, p) => s + p.minor, 0)
  const plural = (n: number) => `(${n} ${n === 1 ? "payment" : "payments"})`

  const summary: Placed[] = [
    { x: 490, top: 18, text: "Asha Example" },
    { x: 389, top: 36, text: "******0042" },
    { x: 445, top: 36, text: "asha.example@ptexample" },
    { x: 69, top: 75, text: "Paytm Statement for" },
    { x: 259, top: 75, text: "Total Money Paid" },
    { x: 428, top: 75, text: "Total Money Received" },
    { x: 55, top: 90, text: "01 oct'26 - 15 nov'26" },
    { x: 259, top: 90, text: `- ${rupees(sum(paid))}` },
    { x: 437, top: 90, text: `+ ${rupees(sum(received))}` },
    { x: 251, top: 108, text: `${paid.length} Payments made` },
    { x: 428, top: 108, text: `${received.length} Payments received` },
    { x: 35, top: 138, text: "Note:" },
    { x: 54, top: 156, text: "Self transfer payments between your own accounts are not shown in this statement" },
    { x: 27, top: 207, text: "Account" },
    { x: 323, top: 207, text: "Payment made" },
    { x: 465, top: 207, text: "Payment received" },
  ]
  ;(["hdfc", "pnb", "sbi", "canara"] as const).forEach((bank, k) => {
    const top = 240 + k * 42
    const out = paid.filter((p) => p.bank === bank)
    const into = received.filter((p) => p.bank === bank)
    const { label, digits } = PAYTM_ACCOUNTS[bank]
    summary.push(
      { x: 48, top, text: `${label} - ${digits}` },
      { x: 332, top, text: rupees(sum(out)) },
      { x: 526 - (into.length > 0 ? 40 : 0), top, text: rupees(sum(into)) },
      { x: 337, top: top + 9, text: plural(out.length) },
      { x: 500, top: top + 9, text: plural(into.length) },
    )
  })
  summary.push({ x: 15, top: 462, text: "Passbook Payments History" })

  const head = (top: number): Placed[] => [
    { x: 22, top: top - 6, text: "Date &" },
    { x: 90, top, text: "Transaction Details" },
    { x: 288, top, text: "Notes & Tags" },
    { x: 395, top, text: "Your Account" },
    { x: 491, top, text: "Amount" },
    { x: 22, top: top + 6, text: "Time" },
  ]
  const pages: Placed[][] = [[...summary, ...head(516)]]
  let y = 561
  for (const p of payments.filter((q) => !drop.has(q.i))) {
    const { items, height } = paytmBlock(p)
    if (y + height > 770) {
      pages.push(head(40))
      y = 85
    }
    pages.at(-1)!.push(...items.map((it) => ({ ...it, top: it.top + y })))
    y += height
  }
  return pages.map((items, n) => page([...items, { x: 9, top: 774, text: `Page ${n + 1} of ${pages.length}` }, { x: 513, top: 783, text: "For any queries, write to us", size: 7 }]))
}

export type PhonePeLayoutPayment = {
  i: number
  kind: "Paid to" | "Received from" | "Bill paid -"
  name: string
  minor: number
  /** "INR" on the first row, the number on the next (amounts of 10,000 or more). */
  wrapped: boolean
  /** The details 3 points below the date (else on its row). */
  lowered: boolean
  masked: boolean
  date: string
  utr: string
}

/** 70 payments, 7 of them 10,000 or more; some payees a masked number. */
export function phonePeLayoutPayments(): PhonePeLayoutPayment[] {
  return Array.from({ length: 70 }, (_, i) => {
    const { day, month } = dayOf(i, 70)
    const wrapped = i % 10 === 4
    const kind = i % 11 === 5 ? "Received from" : i % 13 === 7 ? "Bill paid -" : "Paid to"
    return {
      i,
      kind,
      name: kind === "Bill paid -" ? "Example Power Ltd" : NAMES[i % NAMES.length]!,
      minor: wrapped ? 1_000_000 + i * 12_345 : (20 + ((i * 53) % 9_000)) * 100 + (i % 3) * 25,
      wrapped,
      lowered: i % 2 === 1,
      masked: kind === "Paid to" && i % 8 === 2,
      date: `${MONTHS[month - 1]} ${String(day).padStart(2, "0")}, 2026`,
      utr: String(612_300_000_000 + i),
    }
  })
}

/** PhonePe's amount: no thousands separator. */
const inr = (minor: number) => (minor / 100).toFixed(2)

export function phonePeLayoutPages(payments: PhonePeLayoutPayment[] = phonePeLayoutPayments()): SyntheticPage[] {
  const pages: Placed[][] = [
    [
      { x: 146, top: 93, text: "Transaction Statement for +919000000042" },
      { x: 146, top: 105, text: "Oct 01, 2026 - Nov 15, 2026" },
    ],
  ]
  const head = (top: number): Placed[] => [
    { x: 81, top, text: "Date" },
    { x: 149, top, text: "Transaction Details" },
    { x: 404, top, text: "Type" },
    { x: 442, top, text: "Amount" },
  ]
  pages[0]!.push(...head(150))
  let y = 174
  for (const p of payments) {
    if (y + 60 > 780) {
      pages.push(head(60))
      y = 84
    }
    const d = p.lowered ? 3 : 0
    const credit = p.kind === "Received from"
    const payee = p.masked ? `XXXXXX${4300 + p.i}` : p.name
    const items: Placed[] = [
      { x: 81, top: 0, text: p.date },
      { x: 149, top: d, text: `${p.kind} ${payee}` },
      { x: 404, top: d, text: credit ? "Credit" : "Debit" },
      ...(p.wrapped ? [{ x: 442, top: d, text: "INR" }, { x: 442, top: 9, text: inr(p.minor) }] : [{ x: 442, top: d, text: `INR ${inr(p.minor)}` }]),
      { x: 81, top: 6 + d, text: `${(p.i % 12) + 1}:${String(p.i % 60).padStart(2, "0")} ${p.i % 2 ? "AM" : "PM"}` },
      { x: 149, top: 9 + d, text: `Transaction ID : T26${String(p.i).padStart(18, "0")}` },
      { x: 149, top: 21 + d, text: `UTR No : ${p.utr}` },
      { x: 149, top: 33 + d, text: `${credit ? "Credited to" : "Debited from"} XX${p.i % 4 === 0 ? "5678" : "1234"}` },
    ]
    pages.at(-1)!.push(...items.map((it) => ({ ...it, top: it.top + y })))
    y += 60
  }
  return pages.map((items, n) => page([...items, { x: 280, top: 800, text: `Page ${n + 1} of ${pages.length}` }], 7))
}

export type BhimLayoutPayment = {
  i: number
  bank: "hdfc" | "pnb" | "canara"
  credit: boolean
  cashback: boolean
  collect: boolean
  minor: number
  status: string
  name: string
  id: string
  date: string
}

export const BHIM_ACCOUNTS = {
  hdfc: { name: "HDFC Bank LTD", number: "XXXXXXXXXX1234", x: 87 },
  pnb: { name: "Punjab National Bank", number: "4321XXXXXXXX5678", x: 85 },
  canara: { name: "Canara Bank", number: "XXXXXXXXXX12345", x: 96 },
} as const

/** 70 rows, 67 SUCCESS; each merchant payment often followed by an NPCI BHIM cashback. */
export function bhimLayoutPayments(): BhimLayoutPayment[] {
  return Array.from({ length: 70 }, (_, i) => {
    const cashback = i % 4 === 1
    const credit = cashback || i % 17 === 6
    const { day, month } = dayOf(i, 70)
    return {
      i,
      bank: (["hdfc", "pnb", "canara"] as const)[i % 3]!,
      credit,
      cashback,
      collect: !credit && i % 23 === 12,
      minor: cashback ? 100 + i * 7 : (15 + ((i * 61) % 4_000)) * 100 + (i % 2) * 50,
      status: i === 20 ? "PENDING" : i === 41 ? "Pending" : i === 58 ? "FAILED" : "SUCCESS",
      name: NAMES[i % NAMES.length]!,
      id: String(612_400_000_000 + i),
      date: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/2026`,
    }
  })
}

/** BHIM pages are A4 landscape: syntheticPdf(pages, { landscape: true }). */
export function bhimLayoutPages(payments: BhimLayoutPayment[] = bhimLayoutPayments()): SyntheticPage[] {
  const S = 6
  const head: Placed[] = [
    { x: 369, top: 18, text: "Transaction History", size: 10 },
    { x: 13, top: 36, text: "Customer Mobile Number: +919000000042", size: 7 },
    { x: 703, top: 36, text: "Transaction History from 01/10/2026 to 15/11/2026", size: 5 },
    { x: 25, top: 54, text: "Date" },
    { x: 57, top: 54, text: "Time" },
    { x: 96, top: 54, text: "Bank Name" },
    { x: 159, top: 54, text: "Account Number" },
    { x: 269, top: 54, text: "Sender" },
    { x: 447, top: 54, text: "Receiver" },
    { x: 586, top: 54, text: "Payment ID/Reference Number" },
    { x: 680, top: 54, text: "Pay/Collect" },
    { x: 720, top: 54, text: "Amount (in Rs.)" },
    { x: 770, top: 54, text: "DR/CR" },
    { x: 802, top: 54, text: "Status" },
  ]
  const me = ["asha.example@okhdfc(asha", "example)"] as const
  const pages: Placed[][] = [[...head]]
  let y = 66
  for (const p of payments) {
    if (y > 570) {
      pages.push([])
      y = 30
    }
    const acct = BHIM_ACCOUNTS[p.bank]
    const other = p.cashback ? ["bhimcashback@npci(NPCI", "BHIM)"] : [`${p.name.toLowerCase().replace(/\s+/g, "")}@ybl(${p.name.split(" ")[0]}`, `${p.name.split(" ").slice(1).join(" ").toLowerCase() || "store"})`]
    const [sender, receiver] = p.credit ? [other, me] : [me, other]
    const amount = (p.minor / 100).toFixed(2)
    pages.at(-1)!.push(
      { x: 17, top: y, text: p.date },
      { x: 53, top: y, text: `${String(9 + (p.i % 12)).padStart(2, "0")}:${String(p.i % 60).padStart(2, "0")}:15` },
      { x: acct.x, top: y, text: acct.name },
      { x: 151, top: y, text: acct.number },
      { x: 232, top: y, text: sender[0] },
      { x: 299, top: y, text: sender[1] },
      { x: 413, top: y, text: receiver[0] },
      { x: 495, top: y, text: receiver[1] },
      { x: 608, top: y, text: p.id },
      { x: 689 - (p.collect ? 8 : 0), top: y, text: p.collect ? "COLLECT" : "PAY" },
      { x: 760 - amount.length * 3.4, top: y, text: amount },
      { x: 775, top: y, text: p.credit ? "CR" : "DR" },
      { x: 797, top: y, text: p.status },
    )
    y += p.i % 2 ? 12 : 9
  }
  return pages.map((items) => page(items, S, true))
}
