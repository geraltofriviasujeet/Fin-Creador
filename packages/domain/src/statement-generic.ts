// Generic credit card statement parser: works on the text of any statement whose transaction
// lines read "<date> [<date>] <description> <amount> [Dr|Cr]", and on summary labels followed
// by their value on the same line. Issuer parsers (PNB first) handle layouts this one cannot.
// A card line with no Dr / Cr marker or minus sign is a debit (spending).
import { type IsoDate } from "./dates";
import {
  MAX_STATEMENT_LINES,
  MAX_STATEMENT_TEXT_CHARS,
  STATEMENT_AMOUNT_SOURCE,
  STATEMENT_DATE_SOURCE,
  type StatementIssue,
  type StatementLine,
  classifyCardLine,
  cleanStatementDescription,
  numberOccurrences,
  parseStatementAmount,
  parseStatementDate,
  statementRowShape,
} from "./statements";

/** What prefills Enter statement; each field is null when the text does not state it. */
export interface CardStatementSummary {
  statementDate: IsoDate | null;
  dueDate: IsoDate | null;
  /** A credit balance gives 0 (nothing to pay). */
  totalMinor: number | null;
  minimumMinor: number | null;
}

/**
 * A statement's own arithmetic, checked against what was read. A "mismatch" means "Check this
 * statement": the review shows it and changes no tick on its own. "unchecked": a figure is missing.
 */
export interface StatementCheck {
  name: "summary" | "purchases" | "invoice_total";
  status: "ok" | "mismatch" | "unchecked";
  /** What the lines or summary boxes add up to, and what the statement says it should be (minor units). */
  foundMinor: number | null;
  expectedMinor: number | null;
}

export interface CardStatementParse {
  summary: CardStatementSummary;
  lines: StatementLine[];
  issues: StatementIssue[];
  /** Self-checks the layout allows (none for the generic parser). */
  checks: StatementCheck[];
}

/** True when the review must show "Check this statement". */
export const statementNeedsCheck = (parse: Pick<CardStatementParse, "checks">): boolean =>
  parse.checks.some((check) => check.status === "mismatch");

const LINE = new RegExp(
  String.raw`^(${STATEMENT_DATE_SOURCE})(?=\s)(?:\s+(?:${STATEMENT_DATE_SOURCE})(?=\s))?\s+(.*?)\s*(${STATEMENT_AMOUNT_SOURCE})(?:\s+\d{1,6})?$`,
  "i",
);
const STARTS_WITH_DATE = new RegExp(String.raw`^(?:${STATEMENT_DATE_SOURCE})(?=\s|$)`, "i");
// An amount on a transaction line has exactly two decimals, so a trailing integer (reward points) is not read as one.
const TWO_DECIMALS = /\.\d{2}(?:\s*(?:Dr|Cr)\.?)?$/i;
const BALANCE_LINE = /^(opening|previous|closing|total)\b|\bbalance\b/i;

const SUMMARY_LABELS = {
  statementDate: /\b(statement|bill(ing)?)\s+(generation\s+)?date\b/i,
  dueDate: /\b(payment\s+)?due\s+date\b|\bpay\s+by\b/i,
  totalMinor: /\btotal\s+(amount\s+)?(due|dues|outstanding)\b|\btotal\s+payable\b/i,
  minimumMinor: /\bmin(imum)?\.?\s+(amount\s+)?(due|payable|payment)\b/i,
} as const;
const DATE_AFTER = new RegExp(String.raw`^[\s:.-]*(${STATEMENT_DATE_SOURCE})(?![\d])`, "i");
const AMOUNT_AFTER = new RegExp(String.raw`^\s*(?:\((?:₹|Rs\.?|INR)\))?\s*:?\s*(${STATEMENT_AMOUNT_SOURCE})(?![\d.,])`, "i");

function readSummary(rows: readonly string[]): CardStatementSummary {
  const summary: CardStatementSummary = { statementDate: null, dueDate: null, totalMinor: null, minimumMinor: null };
  for (const row of rows) {
    for (const field of ["statementDate", "dueDate"] as const) {
      if (summary[field] !== null) continue;
      const label = SUMMARY_LABELS[field].exec(row);
      const value = label && DATE_AFTER.exec(row.slice(label.index + label[0].length));
      if (value) summary[field] = parseStatementDate(value[1]!);
    }
    for (const field of ["totalMinor", "minimumMinor"] as const) {
      if (summary[field] !== null) continue;
      const label = SUMMARY_LABELS[field].exec(row);
      const value = label && AMOUNT_AFTER.exec(row.slice(label.index + label[0].length));
      const amount = value && parseStatementAmount(value[1]!);
      if (amount) summary[field] = amount.direction === "credit" ? 0 : amount.minor;
    }
  }
  return summary;
}

/** Reads a card statement's text into its summary and transaction lines. */
export function parseCardStatementText(text: string): CardStatementParse {
  const empty: CardStatementSummary = { statementDate: null, dueDate: null, totalMinor: null, minimumMinor: null };
  if (text.length > MAX_STATEMENT_TEXT_CHARS) return { summary: empty, lines: [], issues: [{ line: 0, reason: "too_long" }], checks: [] };

  const rows = text.split(/\r\n|\r|\n/).map((row) => row.replace(/\s+/g, " ").trim());
  const issues: StatementIssue[] = [];
  const lines: Omit<StatementLine, "occurrence">[] = [];
  for (const [index, row] of rows.entries()) {
    if (!STARTS_WITH_DATE.test(row)) continue;
    const lineNumber = index + 1;
    const m = LINE.exec(row);
    if (!m || !TWO_DECIMALS.test(m[3]!)) {
      issues.push({ line: lineNumber, reason: "no_amount", shape: statementRowShape(row) });
      continue;
    }
    const date = parseStatementDate(m[1]!);
    const amount = parseStatementAmount(m[3]!);
    if (!date || !amount) {
      issues.push({ line: lineNumber, reason: date ? "bad_amount" : "bad_date", shape: statementRowShape(row) });
      continue;
    }
    if (BALANCE_LINE.test(m[2]!)) continue;
    const { description, foreignCurrency } = cleanStatementDescription(m[2]!);
    if (description === "") {
      issues.push({ line: lineNumber, reason: "no_description", shape: statementRowShape(row) });
      continue;
    }
    if (lines.length === MAX_STATEMENT_LINES) {
      issues.push({ line: lineNumber, reason: "too_many_lines", shape: statementRowShape(row) });
      break;
    }
    const direction = amount.direction ?? "debit";
    lines.push({
      date, amountMinor: amount.minor, direction, kind: classifyCardLine(direction, description), description, foreignCurrency,
    });
  }
  return { summary: readSummary(rows), lines: numberOccurrences(lines), issues, checks: [] };
}
