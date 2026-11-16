// Paytm UPI statement (Sprint 9e), from the owner's description. A summary page (period,
// totals, the person's accounts as "<Bank name> - <2 digits>"), then one block per payment:
//   <date> [<time>]
//   Paid to <name> | Money sent to <name> | Received from <name> | Recharge of <name>
//   UPI ID: <handle> ...            (dropped)
//   UPI Ref No: <reference>         (the key only)
//   [Note: <text>]                  (dropped)
//   Tag: # <tag>
//   <Bank name> - <digits>          (often wrapped over two lines)
//   - Rs.65 | + Rs.1,234.50
// Cells may sit side by side (a table) or one under another: a block is every cell from its date
// to the next one, read by what each cell looks like. A bank name wrapped over two lines is joined
// from the same column (or, in plain text, the line before). Dates may be printed without a year;
// the summary's period gives it. Paytm doesn't list self transfers.
import { type IsoDate } from "./dates";
import { MAX_STATEMENT_TEXT_CHARS, type StatementIssue } from "./statements";
import {
  MAX_UPI_ROWS,
  type UpiAccountRef,
  type UpiCell,
  type UpiRow,
  type UpiRowKind,
  type UpiStatementParse,
  type UpiTextRow,
  cleanUpiPayee,
  dateInPeriod,
  isUpiTime,
  parseUpiAccount,
  parseUpiAmount,
  parseUpiDate,
  parseUpiDayMonth,
  parseUpiPeriod,
  sameColumn,
  upiBlocks,
  upiCells,
  upiChecks,
  upiIssue,
  upiPeriod,
  upiStatusOf,
} from "./statement-upi";

/** Paytm's tags, as printed. */
export const PAYTM_TAGS = [
  "Food", "Groceries", "Medical", "Shopping", "Taxi", "Entertainment", "Bill Payments", "Miscellaneous",
  "Services", "Financial Services", "Money Transfer", "Money Received",
] as const;

const TYPE = /^(Paid to|Money sent to|Received from|Recharge of)\s+(.+)$/i;
const KINDS: Record<string, UpiRowKind> = { "paid to": "paid", "money sent to": "sent", "received from": "received", "recharge of": "recharge" };
const AMOUNT = /^([-+])\s*(Rs\.?\s*[\d,]+(?:\.\d{1,2})?)$/i;
// A follow-on line can be merged into the cell above it by the PDF reader, so these are found anywhere in a cell.
const REF = /\bUPI\s*Ref(?:erence)?\.?\s*(?:No\.?|Number)?\s*:?\s*([0-9A-Za-z]{6,35})\b/i;
const TAG = /\bTag\s*:?\s*#\s*([A-Za-z][A-Za-z &]*?)\s*$/i;
const DROPPED = /^(?:UPI\s*ID|Note)\b/i;
const ACCOUNT_END = /-\s*\d{2,4}$/;
const WORDS = /^[A-Za-z][A-Za-z .&()']*$/;

const isDateCell = (cell: string) => parseUpiDate(cell) !== null || parseUpiDayMonth(cell) !== null;

export const isPaytmStatement = (text: string): boolean =>
  /\bpaytm\b/i.test(text.slice(0, 5_000)) || (/UPI\s*Ref(?:erence)?\.?\s*No/i.test(text) && /\bTag\s*:?\s*#/i.test(text));

function totalIn(text: string, label: RegExp): number | null {
  const m = new RegExp(String.raw`${label.source}\s*:?\s*[-+]?\s*((?:Rs\.?|₹)\s*[\d,]+(?:\.\d{1,2})?)`, "i").exec(text);
  return m ? parseUpiAmount(m[1]!) : null;
}

/** The account in a block's remaining cells: "<Bank> - <digits>", with a first line above it in its column (or just before it) when wrapped. */
function accountIn(rest: readonly UpiCell[]): UpiAccountRef | null {
  const end = rest.findIndex((c) => ACCOUNT_END.test(c.text));
  if (end === -1) return null;
  const last = rest[end]!;
  const above = rest
    .slice(0, end)
    .filter((c) => WORDS.test(c.text) && (last.span ? sameColumn(c, last) && c.line < last.line : true))
    .at(-1);
  const head = above && (last.span || rest[end - 1] === above) ? `${above.text} ` : "";
  return parseUpiAccount(`${head}${last.text}`, "dash");
}

export function parsePaytmStatement(rows: readonly UpiTextRow[]): UpiStatementParse {
  const text = rows.map((r) => r.text).join("\n");
  const empty: UpiStatementParse = { app: "paytm", period: { from: null, to: null }, rows: [], issues: [], checks: [] };
  if (text.length > MAX_STATEMENT_TEXT_CHARS) return { ...empty, issues: [{ line: 0, reason: "too_long" }] };

  const { blocks } = upiBlocks(rows, (row) => isDateCell(row.cells[0]!));
  // The header: every row before the first payment (a date with a payment type).
  const start = blocks.find((b) => upiCells(b).some((c) => TYPE.test(c.text)))?.[0]?.line ?? Infinity;
  const header = rows.filter((r) => r.line < start);
  let printed: { from: IsoDate; to: IsoDate } | null = null;
  for (const row of header) for (const cell of [row.text, ...row.cells]) printed ??= parseUpiPeriod(cell);

  const out: UpiRow[] = [];
  const issues: StatementIssue[] = [];
  for (const block of blocks) {
    const first = block[0]!;
    const cells = upiCells(block);
    const texts = cells.map((c) => c.text);
    const type = texts.map((c) => TYPE.exec(c)).find((m) => m !== null);
    // A date row with no payment type (the summary's tail, a printed date in a footer): not a payment.
    if (!type) continue;
    if (out.length + issues.length >= MAX_UPI_ROWS) {
      issues.push({ line: first.line, reason: "too_many_lines" });
      break;
    }
    const dm = parseUpiDayMonth(texts[0]!);
    const date = parseUpiDate(texts[0]!) ?? (dm ? dateInPeriod(dm, printed ?? { from: null, to: null }) : null);
    if (!date) {
      issues.push(upiIssue(first, "bad_date"));
      continue;
    }
    const amount = texts.map((c) => AMOUNT.exec(c)).find((m) => m !== null);
    const minor = amount ? parseUpiAmount(amount[2]!) : null;
    if (!amount || minor === null) {
      issues.push(upiIssue(first, amount ? "bad_amount" : "no_amount"));
      continue;
    }
    const ref = texts.map((c) => REF.exec(c)).find((m) => m !== null)?.[1];
    if (!ref) {
      issues.push(upiIssue(first, "no_reference"));
      continue;
    }
    const rest = cells.slice(1).filter((c) => !TYPE.test(c.text) && !AMOUNT.test(c.text) && !REF.test(c.text) && !TAG.test(c.text) && !DROPPED.test(c.text) && !isUpiTime(c.text));
    const account = accountIn(rest);
    if (!account || account.bankLabel === "") {
      issues.push(upiIssue(first, "no_account"));
      continue;
    }
    out.push({
      line: first.line,
      date,
      kind: KINDS[type[1]!.toLowerCase()]!,
      direction: amount[1] === "+" ? "credit" : "debit",
      amountMinor: minor,
      payee: cleanUpiPayee(type[2]!),
      tag: texts.map((c) => TAG.exec(c)).find((m) => m !== null)?.[1]?.trim() ?? null,
      account,
      viaLite: false,
      toAccount: null,
      status: upiStatusOf(texts),
      ref,
    });
  }

  const headerText = header.map((r) => r.text).join("\n");
  const totals = {
    sentMinor: totalIn(headerText, /Total\s+(?:Money\s+)?(?:Paid|Sent|Spent)/),
    receivedMinor: totalIn(headerText, /Total\s+(?:Money\s+)?Received/),
  };
  return { app: "paytm", period: upiPeriod(printed, out), rows: out, issues, checks: upiChecks(out, totals) };
}
