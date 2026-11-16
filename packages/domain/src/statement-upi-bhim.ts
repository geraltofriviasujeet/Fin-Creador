// BHIM statement (Sprint 9e), from the owner's description: one table row per payment
//   <dd/mm/yyyy> <time> <bank name> <masked account> <sender upi id>(<name>) <receiver upi id>(<name>)
//   <payment id> <type> <amount> <status>
// The payee is the other side: the receiver of a debit, the sender of a credit (the person's own
// name is never kept). A credit from "NPCI BHIM" is cashback. Only SUCCESS rows are imported;
// failed and pending rows are counted. A row wrapped onto the next line(s) is joined first.
import { MAX_STATEMENT_TEXT_CHARS, type StatementIssue } from "./statements";
import {
  MAX_UPI_ROWS,
  type UpiRow,
  type UpiRowStatus,
  type UpiStatementParse,
  type UpiTextRow,
  cleanUpiPayee,
  parseUpiAccount,
  parseUpiAmount,
  parseUpiDate,
  upiChecks,
  upiIssue,
  upiPeriod,
} from "./statement-upi";

const STARTS = /^\d{1,2}\/\d{1,2}\/\d{4}\b/;
const PARTY = String.raw`(?:NPCI\s+BHIM(?:\s*\([^)]*\))?|\S+@\S+?\s*\([^)]*\))`;
const ROW = new RegExp(
  String.raw`^(\d{1,2}\/\d{1,2}\/\d{4})\s+(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?\s+)?(.+?)\s+([Xx*•]+\d{2,4})\s+(${PARTY})\s+(${PARTY})\s+([0-9A-Za-z]{6,40})\s+(DEBIT|CREDIT|DR|CR)\s+(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)\s+(SUCCESS(?:FUL)?|FAILED|FAILURE|PENDING|DECLINED)$`,
  "i",
);
const NAME = /\(([^)]*)\)\s*$/;

export const isBhimStatement = (text: string): boolean => {
  const head = text.slice(0, 5_000);
  return /\bBHIM\b/.test(head) || (/\bsender\b/i.test(head) && /\breceiver\b/i.test(head) && /\bstatus\b/i.test(head));
};

const statusOf = (s: string): UpiRowStatus => (/^success/i.test(s) ? "success" : /^pending/i.test(s) ? "pending" : "failed");

export function parseBhimStatement(rows: readonly UpiTextRow[]): UpiStatementParse {
  const text = rows.map((r) => r.text).join("\n");
  const empty: UpiStatementParse = { app: "bhim", period: { from: null, to: null }, rows: [], issues: [], checks: [] };
  if (text.length > MAX_STATEMENT_TEXT_CHARS) return { ...empty, issues: [{ line: 0, reason: "too_long" }] };

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
    const minor = parseUpiAmount(m[8]!);
    const account = parseUpiAccount(`${m[2]} ${m[3]}`, "masked");
    if (!date || minor === null || !account) {
      issues.push(upiIssue(row, !date ? "bad_date" : minor === null ? "bad_amount" : "no_account"));
      continue;
    }
    const credit = /^c/i.test(m[7]!);
    const sender = m[4]!;
    const cashback = credit && /^NPCI\s+BHIM/i.test(sender);
    const other = credit ? sender : m[5]!;
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
      status: statusOf(m[9]!),
      ref: m[6]!,
    });
  }
  return { app: "bhim", period: upiPeriod(null, out), rows: out, issues, checks: upiChecks(out, { sentMinor: null, receivedMinor: null }) };
}
