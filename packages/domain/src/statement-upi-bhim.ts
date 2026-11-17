// BHIM statement (Sprint 9e), from the owner's description and a masked layout of a real one. A
// title "Transaction History", "Customer Mobile Number: <phone>" (dropped) with the period
// ("Transaction History from dd/mm/yyyy to dd/mm/yyyy"), then one wide table row per payment:
//   Date | Time | Bank Name | Account Number | Sender | Receiver | Payment ID/Reference Number |
//   Pay/Collect | Amount (in Rs.) | DR/CR | Status
// Direction comes from DR/CR. The payee is the other side: the receiver of a debit, the sender of a
// credit (the person's own name is never kept); each side is "<upi id>(<name>)", the name possibly
// wrapped or absent. A credit whose sender is NPCI BHIM is cashback. The account number is masked
// with its first and last digits shown ("XXXXXXXXXX1234", "4321XXXXXXXX5678", "XXXXXXXXXX12345"):
// only the last 4 are kept. Only SUCCESS rows are imported; pending and failed rows are counted.
// A row wrapped onto the next line(s) is joined first. An older order (type before the amount,
// "DEBIT 139.00 SUCCESS", no Pay/Collect) is read too.
import { type IsoDate } from "./dates";
import { MAX_STATEMENT_TEXT_CHARS, type StatementIssue } from "./statements";
import {
  MAX_UPI_ROWS,
  type UpiRow,
  type UpiRowStatus,
  type UpiStatementParse,
  type UpiTextRow,
  cleanUpiPayee,
  emptyUpiParse,
  parseUpiAccount,
  parseUpiAmount,
  parseUpiDate,
  parseUpiPeriod,
  upiChecks,
  upiCount,
  upiIssue,
  upiPeriod,
} from "./statement-upi";

const STARTS = /^\d{1,2}\/\d{1,2}\/\d{4}\b/;
const DIRECTION = String.raw`(DEBIT|CREDIT|DR|CR)`;
const AMOUNT = String.raw`(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)`;
const ROW = new RegExp(
  String.raw`^(\d{1,2}\/\d{1,2}\/\d{4})\s+(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?\s+)?(.+?)\s+(\d{0,6}[Xx*•]+(\d{2,6}))\s+(.+?)\s+([0-9A-Za-z]{6,40})\s+(?:(?:PAY|COLLECT)\s+)?` +
    String.raw`(?:${DIRECTION}\s+${AMOUNT}|${AMOUNT}\s+${DIRECTION})\s+([A-Za-z]+(?:\s[A-Za-z]+)?)$`,
  "i",
);
const NAME = /\(([^)]*)\)?\s*$/;
const NPCI = /NPCI\s*BHIM/i;

export const isBhimStatement = (text: string): boolean => {
  const head = text.slice(0, 5_000);
  return (/\bsender\b/i.test(head) && /\breceiver\b/i.test(head) && /\bstatus\b/i.test(head)) || (/\bBHIM\b/.test(head) && /Customer Mobile Number/i.test(head));
};

const statusOf = (s: string): UpiRowStatus => (/^success/i.test(s) ? "success" : /^(?:pending|processing)/i.test(s) ? "pending" : "failed");

/**
 * Sender and receiver from the text between the account and the payment id: each side starts at a
 * UPI id (x@y) or "NPCI BHIM" outside brackets. Null unless exactly two sides.
 */
function parties(text: string): [string, string] | null {
  const starts: number[] = [];
  let depth = 0;
  const tokens = [...text.matchAll(/\S+/g)];
  for (const t of tokens) {
    const word = t[0];
    if (depth === 0 && (word.includes("@") || /^NPCI$/i.test(word))) starts.push(t.index);
    depth = Math.max(0, depth + (word.match(/\(/g)?.length ?? 0) - (word.match(/\)/g)?.length ?? 0));
  }
  if (starts.length !== 2) return null;
  return [text.slice(0, starts[1]).trim(), text.slice(starts[1]).trim()];
}

export function parseBhimStatement(rows: readonly UpiTextRow[]): UpiStatementParse {
  const text = rows.map((r) => r.text).join("\n");
  if (text.length > MAX_STATEMENT_TEXT_CHARS) return emptyUpiParse("bhim");

  const start = rows.findIndex((r) => STARTS.test(r.cells.join(" ").trim()));
  let printed: { from: IsoDate; to: IsoDate } | null = null;
  for (const row of start === -1 ? rows : rows.slice(0, start)) for (const cell of [row.text, ...row.cells]) printed ??= parseUpiPeriod(cell);

  const out: UpiRow[] = [];
  const issues: StatementIssue[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const own = row.cells.join(" ").replace(/\s+/g, " ").trim();
    if (!STARTS.test(own)) continue;
    if (out.length + issues.length >= MAX_UPI_ROWS) {
      issues.push({ line: row.line, reason: "too_many_lines" });
      break;
    }
    // A wrapped row: join up to two following lines that don't start a payment.
    let joined = own;
    let m = ROW.exec(joined);
    for (let k = 1; !m && k <= 2 && i + k < rows.length; k++) {
      const next = rows[i + k]!.cells.join(" ").trim();
      if (STARTS.test(next)) break;
      joined = `${joined} ${next}`.replace(/\s+/g, " ");
      m = ROW.exec(joined);
      if (m) i += k;
    }
    if (!m) {
      issues.push(upiIssue(row, /\d[\d,]*\.\d{2}/.test(own) ? "bad_amount" : "no_amount"));
      continue;
    }
    const date = parseUpiDate(m[1]!);
    const minor = parseUpiAmount(m[8] ?? m[9]!);
    const account = parseUpiAccount(`${m[2]} XX${m[4]!.slice(-4)}`, "masked");
    const sides = parties(m[5]!);
    if (!date || minor === null || !account || !sides) {
      issues.push(upiIssue(row, !date ? "bad_date" : minor === null ? "bad_amount" : "no_account"));
      continue;
    }
    const credit = /^c/i.test(m[7] ?? m[10]!);
    const [sender, receiver] = sides;
    const cashback = credit && NPCI.test(sender);
    const other = credit ? sender : receiver;
    out.push({
      line: row.line,
      date,
      kind: cashback ? "cashback" : credit ? "received" : "paid",
      direction: credit ? "credit" : "debit",
      amountMinor: minor,
      payee: cashback ? "BHIM cashback" : cleanUpiPayee(NAME.exec(other)?.[1] ?? ""),
      tag: null,
      account,
      viaLite: false,
      toAccount: null,
      status: statusOf(m[11]!),
      ref: m[6]!,
    });
  }
  return {
    app: "bhim",
    period: upiPeriod(printed, out),
    rows: out,
    issues,
    checks: upiChecks(out, { sentMinor: null, receivedMinor: null }),
    count: upiCount(out, issues),
    accountCounts: [],
  };
}
