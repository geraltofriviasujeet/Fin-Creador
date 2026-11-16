// Google Pay statement (Sprint 9e), from the owner's description. A header "Transaction statement",
// the person's phone and email (dropped), the period, and Sent / Received totals, then one block
// per payment:
//   <DD Mon, YYYY> <time>
//   Paid to <name> | Received from <name> | Self transfer to <Bank name> <digits> | Top-up to UPI Lite
//   UPI Transaction ID: <id>                                  (the key)
//   Paid by <Bank name> <digits> | Paid by UPI Lite | <Bank name> <digits> | Paid to <Bank name> <digits>
//   ₹349 | ₹2,56,640.60                                       (no sign: the row type gives the direction)
// "Paid by UPI Lite" payments left UPI Lite, not the bank, at that moment; the top-up left the bank.
import { type IsoDate } from "./dates";
import { MAX_STATEMENT_TEXT_CHARS, type StatementIssue } from "./statements";
import {
  MAX_UPI_ROWS,
  type UpiAccountRef,
  type UpiRow,
  type UpiRowKind,
  type UpiStatementParse,
  type UpiTextRow,
  cleanUpiPayee,
  parseUpiAccount,
  parseUpiAmount,
  parseUpiDate,
  parseUpiPeriod,
  upiBlocks,
  upiCells,
  upiChecks,
  upiIssue,
  upiPeriod,
  upiStatusOf,
} from "./statement-upi";

const DATE = /^\d{1,2} [A-Za-z]{3,9},? \d{4}$/;
const TYPE = /^(Paid to|Received from|Self transfer to|Top-up to)\s+(.+)$/i;
const KINDS: Record<string, UpiRowKind> = { "paid to": "paid", "received from": "received", "self transfer to": "self_transfer", "top-up to": "lite_topup" };
// The id and the account line can share a cell (the PDF reader merges a follow-on line into the one
// above), so both are read from the block's text: the account is the first "Paid by / to" after the id.
const REF = /\bUPI\s*Transaction\s*ID\s*:?\s*([0-9A-Za-z]{6,40})\b/i;
const VIA = /\bPaid (by|to)\s+(UPI\s*Lite\s*\|\s*)?([A-Za-z][A-Za-z .&()']*?\s+[Xx*•]*\d{2,4})(?!\d)/i;
const AMOUNT = /^₹\s*[\d,]+(?:\.\d{1,2})?$/;

export const isGooglePayStatement = (text: string): boolean =>
  /^Transaction statement\b/m.test(text.slice(0, 5_000)) && /UPI\s*Transaction\s*ID/i.test(text);

function totalIn(text: string, label: string): number | null {
  const m = new RegExp(String.raw`(?:^|\s)${label}\s*:?\s*(₹\s*[\d,]+(?:\.\d{1,2})?)`, "im").exec(text);
  return m ? parseUpiAmount(m[1]!) : null;
}

export function parseGooglePayStatement(rows: readonly UpiTextRow[]): UpiStatementParse {
  const text = rows.map((r) => r.text).join("\n");
  const empty: UpiStatementParse = { app: "google_pay", period: { from: null, to: null }, rows: [], issues: [], checks: [] };
  if (text.length > MAX_STATEMENT_TEXT_CHARS) return { ...empty, issues: [{ line: 0, reason: "too_long" }] };

  const { blocks } = upiBlocks(rows, (row) => DATE.test(row.cells[0]!) && parseUpiDate(row.cells[0]!) !== null);
  const start = blocks[0]?.[0]?.line ?? Infinity;
  const header = rows.filter((r) => r.line < start);
  let printed: { from: IsoDate; to: IsoDate } | null = null;
  for (const row of header) for (const cell of [row.text, ...row.cells]) printed ??= parseUpiPeriod(cell);

  const out: UpiRow[] = [];
  const issues: StatementIssue[] = [];
  for (const block of blocks) {
    const first = block[0]!;
    const texts = upiCells(block).map((c) => c.text);
    const typeAt = texts.findIndex((c) => TYPE.test(c));
    if (typeAt === -1) continue;
    if (out.length + issues.length >= MAX_UPI_ROWS) {
      issues.push({ line: first.line, reason: "too_many_lines" });
      break;
    }
    const type = TYPE.exec(texts[typeAt]!)!;
    const kind = KINDS[type[1]!.toLowerCase()]!;
    const amountCell = texts.find((c) => AMOUNT.test(c));
    const minor = amountCell ? parseUpiAmount(amountCell) : null;
    if (minor === null) {
      issues.push(upiIssue(first, amountCell ? "bad_amount" : "no_amount"));
      continue;
    }
    const joined = texts.join("\n");
    const ref = REF.exec(joined);
    if (!ref) {
      issues.push(upiIssue(first, "no_reference"));
      continue;
    }
    // The account line comes after the transaction id ("Paid to <name>" before it is the row type).
    const via = VIA.exec(joined.slice(ref.index + ref[0].length));
    const lite = via?.[2] !== undefined;
    const account = via ? parseUpiAccount(via[3]!, "space") : null;
    let toAccount: UpiAccountRef | null = null;
    if (kind === "self_transfer") toAccount = parseUpiAccount(type[2]!, "space");
    const liteTopup = kind === "lite_topup" && /^UPI\s*Lite$/i.test(type[2]!.trim());
    if (!account || (kind === "self_transfer" && !toAccount) || (kind === "lite_topup" && !liteTopup)) {
      issues.push(upiIssue(first, "no_account"));
      continue;
    }
    const credit = kind === "received";
    out.push({
      line: first.line,
      date: parseUpiDate(texts[0]!)!,
      kind,
      direction: credit ? "credit" : "debit",
      amountMinor: minor,
      payee: kind === "paid" || kind === "received" ? cleanUpiPayee(type[2]!) : "",
      tag: null,
      account,
      viaLite: lite,
      toAccount,
      status: upiStatusOf(texts),
      ref: ref[1]!,
    });
  }

  const headerText = header.map((r) => r.text).join("\n");
  const totals = { sentMinor: totalIn(headerText, "Sent"), receivedMinor: totalIn(headerText, "Received") };
  return { app: "google_pay", period: upiPeriod(printed, out), rows: out, issues, checks: upiChecks(out, totals) };
}
