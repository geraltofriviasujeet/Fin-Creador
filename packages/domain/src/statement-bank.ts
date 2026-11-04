// Bank account statement parser (Sprint 9b), PNB savings layout first (owner's description in
// text; synthetic fixtures only). Everything above the column header row (account number, name,
// address) is skipped and never kept. Each row after it reads
//   <date> [<instrument id>] <amount> <DR|CR> <balance> [<remarks>]
// with amounts printed without thousand commas and balances with or without them; the instrument
// id is dropped. Remarks may wrap onto the rows below (joined with a space) and UPI remarks keep
// the payee only (cleanStatementDescription). Rows are newest first. Self-checks: the balance chain
// (each balance follows from the one before it in time), and the statement's own opening and closing
// balances when it prints them below the header ("Opening Balance", "Closing Balance").
import { type IsoDate } from "./dates";
import {
  MAX_STATEMENT_TEXT_CHARS,
  type BalanceOrder,
  type StatementDirection,
  type StatementIssue,
  checkBalanceChain,
  cleanStatementDescription,
  isStatementPageFooter,
  numberOccurrences,
  parseStatementAmountWithType,
  parseStatementBalance,
  parseStatementDate,
  statementRowShape,
} from "./statements";
import { addMinor } from "./money";
import { uuidV5 } from "./uuid-v5";

/** Lines read from one bank statement (a year of rows is normal); the save step uses the same cap. */
export const MAX_BANK_STATEMENT_LINES = 3_000;

export interface BankStatementLine {
  date: IsoDate;
  /** Positive integer minor units in the account's currency. */
  amountMinor: number;
  direction: StatementDirection;
  /** Cleaned remarks: UPI payee only, digit runs stripped; "" when the row has none. */
  description: string;
  /** Running balance after the line, signed (negative: overdrawn). */
  balanceMinor: number;
  /** 0 for the first of identical lines (same date, amount, direction and description), then 1, 2... */
  occurrence: number;
}

export interface BankStatementSummary {
  /** First and last line dates (null when there are no lines). */
  from: IsoDate | null;
  to: IsoDate | null;
  /** As printed below the header; null when the statement doesn't print it. */
  openingMinor: number | null;
  closingMinor: number | null;
}

/**
 * A bank statement's own arithmetic. "mismatch" means "Check this statement": the review shows it
 * and changes no tick on its own. "unchecked": a figure is missing.
 */
export interface BankStatementCheck {
  name: "balance_chain" | "opening" | "closing";
  status: "ok" | "mismatch" | "unchecked";
  foundMinor: number | null;
  expectedMinor: number | null;
  /** balance_chain: indexes (in `lines`) of lines whose balance doesn't follow. */
  lines?: number[];
}

export interface BankStatementParse {
  summary: BankStatementSummary;
  lines: BankStatementLine[];
  issues: StatementIssue[];
  checks: BankStatementCheck[];
}

const DATE = String.raw`\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[ -][A-Za-z]{3,9},?[ -]\d{2,4}|\d{4}-\d{2}-\d{2}`;
// Date, optional instrument id (dropped), amount, DR / CR, balance, remarks.
const ROW = new RegExp(
  String.raw`^(${DATE})\s+(?:.*?\s+)??(\d[\d,]*(?:\.\d{1,2})?)\s+(DR|CR|D|C)\.?\s+(-?\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:Dr|Cr)\b\.?)?)(?:\s+(.*))?$`,
  "i",
);
const STARTS_WITH_DATE = new RegExp(String.raw`^(?:${DATE})(?:\s|$)`, "i");
const SUMMARY = /^(opening|closing) balance\b[\s:]*(.*)$/i;
// Rows that end a wrapped remark: totals, end markers, page furniture.
const NOT_REMARKS = /^(total\b|end of statement|statement summary|page \d|generated on|this is a (computer|system) generated)/i;

/** The column header row: Date, Amount, Type (or DR / CR), Balance, and Remarks (or Narration / Particulars). */
export function isBankHeaderRow(row: string): boolean {
  return (
    /\bdate\b/i.test(row) &&
    /\bamount\b/i.test(row) &&
    /\b(type|dr\s*\/\s*cr)\b/i.test(row) &&
    /\bbalance\b/i.test(row) &&
    /\b(remarks?|narration|particulars|description)\b/i.test(row)
  );
}

type RawLine = Omit<BankStatementLine, "occurrence" | "description"> & { remarks: string[]; line: number };

export function parsePnbSavingsStatementText(text: string): BankStatementParse {
  const empty: BankStatementSummary = { from: null, to: null, openingMinor: null, closingMinor: null };
  if (text.length > MAX_STATEMENT_TEXT_CHARS) return { summary: empty, lines: [], issues: [{ line: 0, reason: "too_long" }], checks: [] };

  const rows = text.split(/\r\n|\r|\n/).map((row) => row.replace(/\s+/g, " ").trim());
  const start = rows.findIndex(isBankHeaderRow);
  if (start === -1) return { summary: empty, lines: [], issues: [], checks: [] };

  const issues: StatementIssue[] = [];
  const raw: RawLine[] = [];
  let openingMinor: number | null = null;
  let closingMinor: number | null = null;
  // The line whose remarks the next rows may continue; a blank row, header, footer or label ends it.
  let open: RawLine | null = null;
  for (let index = start + 1; index < rows.length; index++) {
    const row = rows[index]!;
    const lineNumber = index + 1;
    if (row === "" || isBankHeaderRow(row) || isStatementPageFooter(row) || NOT_REMARKS.test(row)) {
      open = null;
      continue;
    }
    const summary = SUMMARY.exec(row);
    if (summary) {
      const value = parseStatementBalance(summary[2]!.replace(/^(?:₹|Rs\.?|INR)\s*/i, ""));
      if (summary[1]!.toLowerCase() === "opening") openingMinor = value;
      else closingMinor = value;
      open = null;
      continue;
    }
    if (!STARTS_WITH_DATE.test(row)) {
      if (open) open.remarks.push(row);
      continue;
    }
    open = null;
    const m = ROW.exec(row);
    const date = m ? parseStatementDate(m[1]!) : null;
    const amount = m ? parseStatementAmountWithType(m[2]!, m[3]!) : null;
    const balance = m ? parseStatementBalance(m[4]!) : null;
    if (!m || !date || !amount || amount.direction === null || balance === null) {
      issues.push({ line: lineNumber, reason: !m ? "no_amount" : date ? "bad_amount" : "bad_date", shape: statementRowShape(row) });
      continue;
    }
    if (raw.length >= MAX_BANK_STATEMENT_LINES) {
      issues.push({ line: lineNumber, reason: "too_many_lines", shape: statementRowShape(row) });
      continue;
    }
    open = { date, amountMinor: amount.minor, direction: amount.direction, balanceMinor: balance, remarks: m[5] ? [m[5]] : [], line: lineNumber };
    raw.push(open);
  }

  const lines = numberOccurrences(
    raw.map(({ remarks, line: _line, ...rest }) => ({ ...rest, description: cleanStatementDescription(remarks.join(" ")).description })),
  );
  const order = bankLineOrder(lines);
  const dates = lines.map((l) => l.date).sort();
  return {
    summary: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, openingMinor, closingMinor },
    lines,
    issues,
    checks: bankChecks(lines, order, openingMinor, closingMinor),
  };
}

/** Newest first unless the dates run the other way (PNB prints newest first). */
function bankLineOrder(lines: readonly BankStatementLine[]): BalanceOrder {
  if (lines.length < 2) return "newest_first";
  return lines[0]!.date < lines[lines.length - 1]!.date ? "oldest_first" : "newest_first";
}

const signed = (line: Pick<BankStatementLine, "amountMinor" | "direction">) => (line.direction === "credit" ? line.amountMinor : -line.amountMinor);

function check(name: BankStatementCheck["name"], found: number | null, expected: number | null): BankStatementCheck {
  if (found === null || expected === null) return { name, status: "unchecked", foundMinor: found, expectedMinor: expected };
  return { name, status: found === expected ? "ok" : "mismatch", foundMinor: found, expectedMinor: expected };
}

function bankChecks(lines: readonly BankStatementLine[], order: BalanceOrder, opening: number | null, closing: number | null): BankStatementCheck[] {
  const chain = checkBalanceChain(lines, order);
  const chainCheck: BankStatementCheck =
    chain.status === "broken"
      ? { name: "balance_chain", status: "mismatch", foundMinor: null, expectedMinor: null, lines: chain.lines }
      : { name: "balance_chain", status: chain.status === "ok" ? "ok" : "unchecked", foundMinor: null, expectedMinor: null };
  if (lines.length === 0) return [chainCheck];
  const oldest = order === "newest_first" ? lines[lines.length - 1]! : lines[0]!;
  const newest = order === "newest_first" ? lines[0]! : lines[lines.length - 1]!;
  // The balance before the oldest line, from the lines themselves.
  const openingFromLines = addMinor(oldest.balanceMinor, -signed(oldest));
  return [chainCheck, check("opening", openingFromLines, opening), check("closing", newest.balanceMinor, closing)];
}

/** True when the review must show "Check this statement" (the balance chain or the printed opening / closing). */
export const bankStatementNeedsCheck = (parse: Pick<BankStatementParse, "checks">): boolean =>
  parse.checks.some((c) => c.status === "mismatch");

export type BankLineSkipReason = "before_account" | "future";

/** Whether a bank line can be imported: dated from the day the account was added up to today. */
export function bankLineDecision(
  line: Pick<BankStatementLine, "date">,
  { accountAddedOn, today }: { accountAddedOn: IsoDate; today: IsoDate },
): { importable: true } | { importable: false; reason: BankLineSkipReason } {
  if (line.date < accountAddedOn) return { importable: false, reason: "before_account" };
  if (line.date > today) return { importable: false, reason: "future" };
  return { importable: true };
}

/**
 * The text a bank line's request key comes from (UUID v5): the account and the line exactly as
 * parsed, its running balance included, so identical lines on one day stay distinct. Edits on the
 * review screen never change it; the same statement imported again gives the same keys.
 */
export function bankStatementLineKeySource(accountId: string, line: BankStatementLine): string {
  return JSON.stringify([
    "bank-statement-line:v1", accountId, line.date, line.amountMinor, line.direction, line.description, line.balanceMinor, line.occurrence,
  ]);
}

/** Namespace of bank statement line request keys (fixed: changing it changes every key). */
export const BANK_STATEMENT_LINE_KEY_NAMESPACE = "5f0c3a2e-8b1d-4c7a-9e64-2d7b9a1f3c50";

export const bankStatementLineKey = (accountId: string, line: BankStatementLine): string =>
  uuidV5(bankStatementLineKeySource(accountId, line), BANK_STATEMENT_LINE_KEY_NAMESPACE);
