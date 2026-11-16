// Synthetic UPI app statements (Sprint 9e), laid out from the owner's descriptions of Paytm,
// PhonePe, BHIM and Google Pay statements: invented people, payees, references and account digits.
// Never a real statement. Pages are for syntheticPdf (synthetic-pdf.ts): 14 points a row.
import type { SyntheticPage, SyntheticRow } from "./synthetic-pdf"

export const PERSON = { name: "Asha Example", phone: "+91 90000 00042", email: "asha.example@example.test" }

/** Rows per page that fit between the page header and footer. */
const ROWS_PER_PAGE = 52

const cell = (x: number, text: string, size?: number) => ({ x, text, ...(size ? { size } : {}) })

/** Lays out blocks of rows over pages, each page starting with `head` and ending with a page number. */
function paginate(first: SyntheticRow[], blocks: SyntheticRow[][], head: SyntheticRow): SyntheticPage[] {
  const pages: SyntheticPage[] = []
  let page: SyntheticPage = [...first]
  for (const block of blocks) {
    if (page.length + block.length + 1 > ROWS_PER_PAGE) {
      pages.push(page)
      page = [head, []]
    }
    page.push(...block, [])
  }
  pages.push(page)
  return pages.map((p, i) => [...p, [cell(480, `Page ${i + 1} of ${pages.length}`)]])
}

export type PaytmPayment = {
  day: string
  type: "Paid to" | "Money sent to" | "Received from" | "Recharge of"
  name: string
  amount: string
  sign: "-" | "+"
  tag: string
  ref: string
  /** The account wrapped over two lines ("State Bank Of" / "India - 12") or on one. */
  account: [string] | [string, string]
  note?: string
  failed?: boolean
}

export const paytmDefaultPayments = (): PaytmPayment[] => [
  { day: "12 Oct", type: "Paid to", name: "Green Leaf Cafe", amount: "Rs.65", sign: "-", tag: "Food", ref: "612345678901", account: ["State Bank Of", "India - 12"], note: "lunch" },
  { day: "13 Oct", type: "Money sent to", name: "Ravi Kumar", amount: "Rs.1,000", sign: "-", tag: "Money Transfer", ref: "612345678902", account: ["Example Bank - 34"] },
  { day: "14 Oct", type: "Received from", name: "Meera N", amount: "Rs.1,234.50", sign: "+", tag: "Money Received", ref: "612345678903", account: ["Example Bank - 34"] },
  { day: "15 Oct", type: "Recharge of", name: "Jio Prepaid 9000000042", amount: "Rs.265", sign: "-", tag: "Bill Payments", ref: "612345678904", account: ["State Bank Of", "India - 12"] },
  { day: "16 Oct", type: "Paid to", name: "Corner Store", amount: "Rs.80", sign: "-", tag: "Groceries", ref: "612345678905", account: ["Example Bank - 34"], failed: true },
]

/**
 * A Paytm statement: a summary page (person, period, totals, accounts), then a table with the date and
 * time, the details (type, UPI ID, UPI Ref No, note, tag), the account (wrapped or not) and the amount.
 * `fillTo`: pages to reach by adding ₹10 "Payee N" payments (references 7000000000NN).
 */
export function paytmPages(options: { payments?: PaytmPayment[]; fillTo?: number; period?: string } = {}): SyntheticPage[] {
  const payments = [...(options.payments ?? paytmDefaultPayments())]
  const head: SyntheticRow = [cell(40, "Date & Time"), cell(130, "Transaction Details"), cell(380, "Your Account"), cell(500, "Amount")]
  const block = (p: PaytmPayment, i: number): SyntheticRow[] => [
    [cell(40, p.day), cell(130, `${p.type} ${p.name}`), cell(380, p.account[0]), cell(500, `${p.sign} ${p.amount}`)],
    [cell(40, `${(i % 12) + 1}:${String(i % 60).padStart(2, "0")} PM`), cell(130, `UPI ID: payee${i}@okexample on ${p.day}`), ...(p.account[1] ? [cell(380, p.account[1])] : [])],
    [cell(130, `UPI Ref No: ${p.ref}`)],
    ...(p.note ? [[cell(130, `Note: ${p.note}`)]] : []),
    [cell(130, `Tag: # ${p.tag}`)],
    ...(p.failed ? [[cell(130, "Failed")]] : []),
  ]
  const sum = (sign: "-" | "+") =>
    payments.filter((p) => p.sign === sign && !p.failed).reduce((a, p) => a + Math.round(Number(p.amount.replace(/^Rs\./, "").replace(/,/g, "")) * 100), 0)
  const summary = (paid: number, received: number): SyntheticRow[] => [
    [cell(40, "Paytm Statement")],
    [cell(40, PERSON.name)],
    [cell(40, PERSON.phone)],
    [cell(40, options.period ?? "01 Aug 2026 - 31 Oct 2026")],
    [cell(40, "Total Money Paid"), cell(300, `- Rs.${(paid / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`)],
    [cell(40, "Total Money Received"), cell(300, `+ Rs.${(received / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`)],
    [cell(40, "Your Accounts")],
    [cell(40, "State Bank Of India - 12")],
    [cell(40, "Example Bank - 34")],
    [],
    head,
    [],
  ]
  let pages = paginate(summary(sum("-"), sum("+")), payments.map(block), head)
  for (let n = 0; options.fillTo && pages.length < options.fillTo; n++) {
    for (let k = 0; k < 10; k++) {
      const i = n * 10 + k
      payments.push({ day: "20 Oct", type: "Paid to", name: `Payee ${i}`, amount: "Rs.10", sign: "-", tag: "Shopping", ref: `70000000${String(i).padStart(4, "0")}`, account: ["Example Bank - 34"] })
    }
    pages = paginate(summary(sum("-"), sum("+")), payments.map(block), head)
  }
  return pages
}

/** A PhonePe statement: header with the phone, the period, then one block per payment. */
export function phonePePages(): SyntheticPage[] {
  const head: SyntheticRow = [cell(40, "Date"), cell(130, "Transaction Details"), cell(380, "Type"), cell(460, "Amount")]
  const block = (date: string, details: string, type: "Debit" | "Credit", amount: string, txn: string, utr: string, account: string, time: string): SyntheticRow[] => [
    [cell(40, date), cell(130, details), cell(380, type), cell(460, amount)],
    [cell(40, time), cell(130, `Transaction ID ${txn}`)],
    [cell(130, `UTR No. ${utr}`)],
    [cell(130, account)],
  ]
  return paginate(
    [[cell(40, `Transaction Statement for ${PERSON.phone.replace(/\D/g, "").slice(-10)}`)], [cell(40, "Oct 01, 2026 - Oct 31, 2026")], [], head, []],
    [
      block("Oct 12, 2026", "Paid to Tomato Foods", "Debit", "INR 139.00", "T2610121024000001", "612345678911", "Debited from XX1234", "10:24 am"),
      block("Oct 14, 2026", "Received from Meera N", "Credit", "INR 500.00", "T2610141024000002", "612345678912", "Credited to XX1234", "09:10 am"),
      block("Oct 15, 2026", "Bill paid - Example Power Ltd", "Debit", "INR 1,200.00", "T2610151024000003", "612345678913", "Debited from XX5678", "06:45 pm"),
    ],
    head,
  )
}

/** A BHIM statement: one table row per payment (small type so the row fits). */
export function bhimPages(): SyntheticPage[] {
  const size = 6
  const row = (cells: string[]): SyntheticRow => {
    let x = 12
    return cells.map((text) => {
      const c = cell(x, text, size)
      x += Math.ceil(text.length * size * 0.62) + 10
      return c
    })
  }
  const pay = (date: string, sender: string, receiver: string, id: string, type: string, amount: string, status: string) =>
    row([date, "10:24:15", "Example Bank", "XXXXXX1234", sender, receiver, id, type, amount, status])
  const me = "asha@upiex(Asha Example)"
  return [
    [
      [cell(40, "BHIM Transaction History")],
      [cell(40, PERSON.name)],
      [],
      row(["Date", "Time", "Bank Name", "Account No", "Sender", "Receiver", "Payment ID", "Type", "Amount", "Status"]),
      pay("12/10/2026", me, "cafe@okex(Green Leaf Cafe)", "612345678921", "DEBIT", "139.00", "SUCCESS"),
      pay("13/10/2026", me, "shop@okex(Corner Store)", "612345678922", "DEBIT", "80.00", "FAILED"),
      pay("13/10/2026", me, "shop@okex(Corner Store)", "612345678923", "DEBIT", "80.00", "PENDING"),
      pay("14/10/2026", "NPCI BHIM", me, "612345678924", "CREDIT", "25.00", "SUCCESS"),
      pay("15/10/2026", "meera@okex(Meera N)", me, "612345678925", "CREDIT", "500.00", "SUCCESS"),
    ],
  ]
}

/** A Google Pay statement: header, person, period and totals, then one block per payment. */
export function googlePayPages(): SyntheticPage[] {
  const block = (date: string, time: string, details: string, ref: string, via: string, amount: string): SyntheticRow[] => [
    [cell(40, date), cell(150, details), cell(500, amount)],
    [cell(40, time), cell(150, `UPI Transaction ID: ${ref}`)],
    [cell(150, via)],
  ]
  return paginate(
    [
      [cell(40, "Transaction statement")],
      [cell(40, `${PERSON.phone}, ${PERSON.email}`)],
      [cell(40, "01 October 2026 - 31 October 2026")],
      [cell(40, "Sent"), cell(120, "₹2,56,640.60")],
      [cell(40, "Received"), cell(120, "₹500")],
      [],
    ],
    [
      block("12 Oct, 2026", "10:24 PM", "Paid to Green Leaf Cafe", "612345678931", "Paid by Example Bank 1234", "₹349"),
      block("13 Oct, 2026", "9:00 AM", "Self transfer to Other Bank 5678", "612345678932", "Paid by Example Bank 1234", "₹2,55,791.60"),
      block("14 Oct, 2026", "9:10 AM", "Top-up to UPI Lite", "612345678933", "Paid by Example Bank 1234", "₹400"),
      block("14 Oct, 2026", "1:10 PM", "Paid to Corner Store", "612345678934", "Paid by UPI Lite | Example Bank 1234", "₹100"),
      block("15 Oct, 2026", "6:00 PM", "Received from Meera N", "612345678935", "Paid to Example Bank 1234", "₹500"),
    ],
    [],
  )
}
