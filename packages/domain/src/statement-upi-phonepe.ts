// PhonePe statement (Sprint 9e), from the owner's description. A header "Transaction Statement
// for <phone>" (dropped) and the period, then one block per payment:
//   <date: Oct 12, 2026> [<time>]
//   Paid to <name> | Received from <name> | Bill paid <biller>
//   Debit | Credit
//   INR 139.00          (10,000 or more: "INR" on the first row, the number on the next, same x)
//   Transaction ID <id>   UTR No. <reference>      (the UTR is the key; else the transaction id)
//   Debited from XX<digits> | Credited to XX<digits>
// Amounts have no thousands separator. Some payees are a masked number ("Paid to XXXXXX1234"):
// the name kept is then empty (masks are never kept). Opened with the existing password prompt
// when protected. PhonePe doesn't list self transfers.
import { type IsoDate } from "./dates";
import { MAX_STATEMENT_TEXT_CHARS, type StatementIssue } from "./statements";
import {
  MAX_UPI_ROWS,
  type UpiCell,
  type UpiRow,
  type UpiRowKind,
  type UpiStatementParse,
  type UpiTextRow,
  cleanUpiPayee,
  emptyUpiParse,
  parseUpiAccount,
  parseUpiAmount,
  parseUpiDate,
  parseUpiPeriod,
  sameColumn,
  upiBlocks,
  upiCells,
  upiChecks,
  upiCount,
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
const CURRENCY = /^(?:INR|₹|Rs\.?)$/i;
const NUMBER = /^[\d,]+(?:\.\d{1,2})?$/;
const UTR = /\bUTR\s*(?:No\.?|Number)?\s*:?\s*([0-9A-Za-z]{6,35})\b/i;
const TXN = /\bTransaction\s*ID\s*:?\s*([0-9A-Za-z]{6,40})\b/i;
// Found anywhere in a cell: the PDF reader can merge it into the transaction id's cell.
const ACCOUNT = /\b(Debited from|Credited to)\s+([Xx*•]+\d{2,4})(?!\d)/i;

export const isPhonePeStatement = (text: string): boolean => /\bTransaction Statement for\b/i.test(text.slice(0, 5_000));

/** "INR" alone, its number on a row below in the same column (else, from plain text, the next number). */
function wrappedAmount(cells: readonly UpiCell[]): string | null {
  const at = cells.findIndex((c) => CURRENCY.test(c.text));
  if (at === -1) return null;
  const unit = cells[at]!;
  const number = cells.slice(at + 1).find((c) => NUMBER.test(c.text) && c.line > unit.line && (unit.span && c.span ? sameColumn(unit, c) : true));
  return number ? `${unit.text} ${number.text}` : null;
}

export function parsePhonePeStatement(rows: readonly UpiTextRow[]): UpiStatementParse {
  const text = rows.map((r) => r.text).join("\n");
  if (text.length > MAX_STATEMENT_TEXT_CHARS) return emptyUpiParse("phonepe");

  const { blocks } = upiBlocks(rows, (row) => DATE.test(row.cells[0]!) && parseUpiDate(row.cells[0]!) !== null);
  const start = blocks[0]?.[0]?.line ?? Infinity;
  let printed: { from: IsoDate; to: IsoDate } | null = null;
  for (const row of rows.filter((r) => r.line < start)) for (const cell of [row.text, ...row.cells]) printed ??= parseUpiPeriod(cell);

  const out: UpiRow[] = [];
  const issues: StatementIssue[] = [];
  for (const block of blocks) {
    const first = block[0]!;
    const cells = upiCells(block);
    const texts = cells.map((c) => c.text);
    const type = texts.map(typeOf).find((m) => m !== null);
    if (!type) continue;
    if (out.length + issues.length >= MAX_UPI_ROWS) {
      issues.push({ line: first.line, reason: "too_many_lines" });
      break;
    }
    const date = parseUpiDate(texts[0]!)!;
    const amountCell = texts.find((c) => AMOUNT.test(c)) ?? wrappedAmount(cells);
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
  return {
    app: "phonepe",
    period: upiPeriod(printed, out),
    rows: out,
    issues,
    checks: upiChecks(out, { sentMinor: null, receivedMinor: null }),
    count: upiCount(out, issues),
    accountCounts: [],
  };
}
