// PhonePe statement (Sprint 9e), from the owner's description. A header "Transaction Statement
// for <phone>" (dropped) and the period, then one block per payment:
//   <date: Oct 12, 2026> [<time>]
//   Paid to <name> | Received from <name> | Bill paid <biller>
//   Debit | Credit
//   INR 139.00
//   Transaction ID <id>   UTR No. <reference>      (the UTR is the key; else the transaction id)
//   Debited from XX<digits> | Credited to XX<digits>
// Opened with the existing password prompt when protected. PhonePe doesn't list self transfers.
import { type IsoDate } from "./dates";
import { MAX_STATEMENT_TEXT_CHARS, type StatementIssue } from "./statements";
import {
  MAX_UPI_ROWS,
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

const DATE = /^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$/;
const TYPE = /^(Paid to|Received from)\s+(.+)$/i;
const BILL = /^(Bill paid)(?:\s+(?:to|for)\s+|\s*[-:]\s*|\s+|$)(.*)$/i;
const typeOf = (cell: string) => TYPE.exec(cell) ?? BILL.exec(cell);
const KINDS: Record<string, UpiRowKind> = { "paid to": "paid", "received from": "received", "bill paid": "bill" };
const DIRECTION = /^(Debit|Credit|DR|CR)$/i;
const AMOUNT = /^(?:INR|₹|Rs\.?)\s*[\d,]+(?:\.\d{1,2})?$/i;
const UTR = /\bUTR\s*(?:No\.?|Number)?\s*:?\s*([0-9A-Za-z]{6,35})\b/i;
const TXN = /\bTransaction\s*ID\s*:?\s*([0-9A-Za-z]{6,40})\b/i;
// Found anywhere in a cell: the PDF reader can merge it into the transaction id's cell.
const ACCOUNT = /\b(Debited from|Credited to)\s+([Xx*•]+\d{2,4})(?!\d)/i;

export const isPhonePeStatement = (text: string): boolean => /\bTransaction Statement for\b/i.test(text.slice(0, 5_000));

export function parsePhonePeStatement(rows: readonly UpiTextRow[]): UpiStatementParse {
  const text = rows.map((r) => r.text).join("\n");
  const empty: UpiStatementParse = { app: "phonepe", period: { from: null, to: null }, rows: [], issues: [], checks: [] };
  if (text.length > MAX_STATEMENT_TEXT_CHARS) return { ...empty, issues: [{ line: 0, reason: "too_long" }] };

  const { blocks } = upiBlocks(rows, (row) => DATE.test(row.cells[0]!) && parseUpiDate(row.cells[0]!) !== null);
  const start = blocks[0]?.[0]?.line ?? Infinity;
  let printed: { from: IsoDate; to: IsoDate } | null = null;
  for (const row of rows.filter((r) => r.line < start)) for (const cell of [row.text, ...row.cells]) printed ??= parseUpiPeriod(cell);

  const out: UpiRow[] = [];
  const issues: StatementIssue[] = [];
  for (const block of blocks) {
    const first = block[0]!;
    const texts = upiCells(block).map((c) => c.text);
    const type = texts.map(typeOf).find((m) => m !== null);
    if (!type) continue;
    if (out.length + issues.length >= MAX_UPI_ROWS) {
      issues.push({ line: first.line, reason: "too_many_lines" });
      break;
    }
    const date = parseUpiDate(texts[0]!)!;
    const amountCell = texts.find((c) => AMOUNT.test(c));
    const minor = amountCell ? parseUpiAmount(amountCell) : null;
    if (minor === null) {
      issues.push(upiIssue(first, amountCell ? "bad_amount" : "no_amount"));
      continue;
    }
    const joined = texts.join(" ");
    const ref = UTR.exec(joined)?.[1] ?? TXN.exec(joined)?.[1];
    if (!ref) {
      issues.push(upiIssue(first, "no_reference"));
      continue;
    }
    const accountCell = texts.map((c) => ACCOUNT.exec(c)).find((m) => m !== null);
    const account = accountCell ? parseUpiAccount(accountCell[2]!, "masked") : null;
    if (!accountCell || !account) {
      issues.push(upiIssue(first, "no_account"));
      continue;
    }
    const kind = KINDS[type[1]!.toLowerCase()]!;
    const printedDirection = texts.find((c) => DIRECTION.test(c))?.toLowerCase();
    const direction =
      printedDirection === "credit" || printedDirection === "cr" ? "credit"
      : printedDirection === "debit" || printedDirection === "dr" ? "debit"
      : /^credited/i.test(accountCell[1]!) ? "credit" : "debit";
    out.push({
      line: first.line,
      date,
      kind,
      direction,
      amountMinor: minor,
      payee: cleanUpiPayee(type[2]!),
      tag: null,
      account,
      viaLite: false,
      toAccount: null,
      status: upiStatusOf(texts),
      ref,
    });
  }
  return { app: "phonepe", period: upiPeriod(printed, out), rows: out, issues, checks: upiChecks(out, { sentMinor: null, receivedMinor: null }) };
}
