// Punjab National Bank credit card statements (Sprint 9a.2), from the owner's description of the
// layout in text (no real statement was used):
// - top block labels Invoice Date (the statement date), Payment Due Date, Total Amount Due, Total
//   Amount Due for Month and Minimum Amount Due; dates DD-MON-YYYY;
// - summary boxes Previous Balance, Purchases and other charges, Cash Advances, Payments and
//   Other Credits / Shadow Credits, Total Amount Due for Month;
// - table Transaction Date, Post Date, [Network/Last 4 Digit], details, Amount in Rs: a debit has
//   no marker (or Dr), a credit ends in Cr; then label-only totals (Total Purchase, Total Taxable
//   Value, Total GST, ...), "Total Invoice Value", adverts and "End of Statement". Lines are read
//   up to the first of Total Purchase or End of Statement; the self-checks (debit lines against
//   Purchases and other charges and Total Invoice Value, and the summary boxes against Total Amount
//   Due) decide whether the review shows "Check this statement".
// Labels and values may share a row, or a row of labels may be followed by a row of values (as text
// taken from boxes and tables reads); both are read. The Network/Last 4 Digit cell is dropped
// before anything else is read from a line, so its digits never leave the parser. The Post Date is
// ignored; a line is dated by its Transaction Date. Descriptions are kept as the bank printed them
// (they may be cut off), cleaned as every statement line is.
import { type IsoDate } from "./dates";
import { addMinor } from "./money";
import { type CardStatementParse, type CardStatementSummary, type StatementCheck, parseCardStatementText } from "./statement-generic";
import {
  MAX_STATEMENT_LINES,
  MAX_STATEMENT_TEXT_CHARS,
  type StatementIssue,
  type StatementLine,
  classifyCardLine,
  cleanStatementDescription,
  isStatementPageFooter,
  numberOccurrences,
  parseStatementAmount,
  parseStatementDate,
  statementRowShape,
} from "./statements";

export interface PnbCardStatementParse extends CardStatementParse {
  /** The period in the details header ("Trnx Details From ... to ..."), when it is printed. */
  period: { from: IsoDate; to: IsoDate } | null;
}

const DATE = String.raw`\d{1,2}-[A-Za-z]{3}-\d{4}`;
// Box values may be whole rupees ("0", "13583") or have paise ("13854.64"), with Dr / Cr or not.
const AMOUNT = String.raw`\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:Dr|Cr)\b)?`;
const VALUE = new RegExp(String.raw`(?<![\w.,])(?:${DATE}|${AMOUNT})(?![\w.,])`, "gi");

// Longest labels first, so "Total Amount Due for Month" is never read as "Total Amount Due".
const FIELDS = [
  ["totalForMonth", String.raw`Total\s+Amount\s+Due\s+for\s+(?:the\s+)?Month`],
  ["total", String.raw`Total\s+Amount\s+Due`],
  ["minimum", String.raw`Minimum\s+Amount\s+Due`],
  ["statementDate", String.raw`Invoice\s+Date`],
  ["dueDate", String.raw`Payment\s+Due\s+Date`],
  ["previous", String.raw`Previous\s+Balance`],
  ["purchases", String.raw`Purchases\s+(?:and|&)\s+other\s+charges`],
  ["cash", String.raw`Cash\s+Advances?`],
  ["payments", String.raw`Payments\s+(?:and|&)\s+Other\s+Credits(?:\s*/\s*Shadow\s+Credits)?`],
  ["invoiceTotal", String.raw`Total\s+Invoice\s+Value`],
] as const;
type Field = (typeof FIELDS)[number][0];
const LABELS = new RegExp(FIELDS.map(([, source]) => `(${source})`).join("|"), "gi");

/** The fields a row labels, in order, with the text after each label up to the next one. */
function labelsIn(row: string): { field: Field; after: string }[] {
  const found: { field: Field; start: number; end: number }[] = [];
  for (const m of row.matchAll(LABELS)) {
    const index = m.slice(1).findIndex((group) => group !== undefined);
    found.push({ field: FIELDS[index]![0], start: m.index, end: m.index + m[0].length });
  }
  return found.map((label, i) => ({ field: label.field, after: row.slice(label.end, found[i + 1]?.start ?? row.length) }));
}

const valuesIn = (text: string): string[] => [...text.matchAll(VALUE)].map((m) => m[0]);

const DATE_FIELDS: ReadonlySet<Field> = new Set(["statementDate", "dueDate"]);
const IS_DATE = new RegExp(String.raw`^${DATE}$`, "i");
/** A date field takes only a date, an amount field only an amount. */
const fits = (field: Field, value: string | undefined): value is string =>
  value !== undefined && DATE_FIELDS.has(field) === IS_DATE.test(value);
/** A row holding values only (dates, amounts and + = - between them). */
const valuesOnly = (row: string) => row.replace(VALUE, "").replace(/[\s+=-]/g, "") === "" && valuesIn(row).length > 0;

/**
 * Raw value text per field, only where the layout says which label it belongs to, never a guess:
 * - beside its label (before the next label on the row);
 * - after the last of several labels on one row, when exactly one value per label without one
 *   follows it ("Invoice Date Payment Due Date 20-SEP-2026 10-OCT-2026"), in label order;
 * - in the next row, when that row holds values only and exactly one per label of the label row.
 * A date field takes only a date and an amount field only an amount; the first reading wins.
 */
function readLabelled(rows: readonly string[]): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {};
  rows.forEach((row, i) => {
    const labels = labelsIn(row);
    if (labels.length === 0) return;
    const found: (string | undefined)[] = labels.map((label) => valuesIn(label.after)[0]);
    const lastValues = valuesIn(labels[labels.length - 1]!.after);
    const firstMissing = found.findIndex((value) => value === undefined);
    if (firstMissing !== -1 && found.slice(firstMissing, -1).every((value) => value === undefined) && lastValues.length === labels.length - firstMissing) {
      lastValues.forEach((value, k) => (found[firstMissing + k] = value));
    }
    if (found.some((value) => value === undefined)) {
      const next = rows.slice(i + 1).find((r) => r !== "");
      const below = next !== undefined && valuesOnly(next) ? valuesIn(next) : [];
      if (below.length === labels.length) below.forEach((value, k) => (found[k] ??= value));
    }
    labels.forEach((label, k) => {
      if (fits(label.field, found[k])) out[label.field] ??= found[k];
    });
  });
  return out;
}

/** A balance-like figure, signed: Cr is a credit (negative), Dr or no marker a debit. */
function signed(text: string | undefined): number | null {
  if (text === undefined) return null;
  const amount = parseStatementAmount(text);
  if (amount) return amount.direction === "credit" ? -amount.minor : amount.minor;
  return /^0+(?:\.0+)?(?:\s*(?:Dr|Cr))?$/i.test(text.replace(/,/g, "")) ? 0 : null;
}

const date = (text: string | undefined): IsoDate | null => (text === undefined ? null : parseStatementDate(text));

const check = (name: StatementCheck["name"], found: number | null, expected: number | null): StatementCheck => ({
  name,
  status: found === null || expected === null ? "unchecked" : found === expected ? "ok" : "mismatch",
  foundMinor: found,
  expectedMinor: expected,
});

// Transaction Date, Post Date, [Network/Last 4 Digit], details, amount: a debit has no marker
// (or Dr, as other statements print), a credit ends in Cr. The network group ("RUPAY -" and the
// last 4 digits or a mask, one piece or two, in either order) is dropped wherever it sits between
// the dates and the details, so its digits never leave the parser.
const NETWORK_NAME = String.raw`(?:RUPAY|VISA|MASTER\s?CARD|AMEX|DINERS(?:\s+CLUB)?|JCB|DISCOVER|UPI)\s*-`;
const LAST4 = String.raw`[\dXx*•#]{4}(?![\dXx*•#])`;
const NETWORK = String.raw`(?:${NETWORK_NAME}\s*${LAST4}|${LAST4}\s+${NETWORK_NAME})`;
const LINE = new RegExp(
  String.raw`^(${DATE})\s+(?:${NETWORK}\s+)?(?:${DATE}\s+)?(?:${NETWORK}\s*)?(.*?)\s*(\d[\d,]*\.\d{2}(?:\s*(?:Dr|Cr))?)\.?$`,
  "i",
);
const STARTS_WITH_DATE = new RegExp(String.raw`^${DATE}(?=\s|$)`, "i");
const PERIOD = new RegExp(String.raw`Trnx\s+Details\s+From\s+(${DATE})\s+to\s+(${DATE})`, "i");
// Rows are read up to the first of the totals below the table ("Total Purchase") or "End of Statement".
const END = /\bEnd\s+of\s+Statement\b|^Total\s+Purchases?\b/i;

/** Reads a PNB credit card statement's text: summary for Enter statement, lines and self-checks. */
export function parsePnbCardStatementText(text: string): PnbCardStatementParse {
  const empty: CardStatementSummary = { statementDate: null, dueDate: null, totalMinor: null, minimumMinor: null };
  if (text.length > MAX_STATEMENT_TEXT_CHARS) {
    return { summary: empty, lines: [], issues: [{ line: 0, reason: "too_long" }], checks: [], period: null };
  }
  const rows = text.split(/\r\n|\r|\n/).map((row) => row.replace(/\s+/g, " ").trim());
  const endRow = rows.findIndex((row) => END.test(row));
  const body = (endRow === -1 ? rows : rows.slice(0, endRow)).map((row) => (isStatementPageFooter(row) ? "" : row));

  const issues: StatementIssue[] = [];
  const lines: Omit<StatementLine, "occurrence">[] = [];
  for (const [index, row] of body.entries()) {
    // A row of values only (the top block's dates and amounts under their labels) is not a line.
    if (!STARTS_WITH_DATE.test(row) || row.replace(VALUE, "").replace(/[\s+=-]/g, "") === "") continue;
    const lineNumber = index + 1;
    const m = LINE.exec(row);
    if (!m) {
      issues.push({ line: lineNumber, reason: "no_amount", shape: statementRowShape(row) });
      continue;
    }
    const lineDate = parseStatementDate(m[1]!);
    const amount = parseStatementAmount(m[3]!);
    if (!lineDate || !amount) {
      issues.push({ line: lineNumber, reason: lineDate ? "bad_amount" : "bad_date", shape: statementRowShape(row) });
      continue;
    }
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
      date: lineDate, amountMinor: amount.minor, direction, kind: classifyCardLine(direction, description), description, foreignCurrency,
    });
  }

  // Labels are read from the whole text: "Total Invoice Value" may sit just before "End of Statement".
  const raw = readLabelled(rows.map((row) => (isStatementPageFooter(row) ? "" : row)));
  const total = signed(raw.total);
  const minimum = signed(raw.minimum);
  const summary: CardStatementSummary = {
    statementDate: date(raw.statementDate),
    dueDate: date(raw.dueDate),
    totalMinor: total === null ? null : Math.max(total, 0),
    minimumMinor: minimum === null ? null : Math.max(minimum, 0),
  };

  const previous = signed(raw.previous);
  const purchases = signed(raw.purchases);
  const cash = signed(raw.cash);
  const payments = raw.payments === undefined ? null : parseStatementAmount(raw.payments)?.minor ?? signed(raw.payments);
  const fromBoxes =
    previous === null || purchases === null || cash === null || payments === null ? null : addMinor(previous, purchases, cash, -payments);
  const debits = lines.length === 0 ? null : addMinor(...lines.filter((l) => l.direction === "debit").map((l) => l.amountMinor));

  const period = rows.map((row) => PERIOD.exec(row)).find((m) => m !== null);
  const from = period ? parseStatementDate(period[1]!) : null;
  const to = period ? parseStatementDate(period[2]!) : null;

  return {
    summary,
    lines: numberOccurrences(lines),
    issues,
    checks: [check("summary", fromBoxes, total), check("purchases", debits, purchases), check("invoice_total", debits, signed(raw.invoiceTotal))],
    period: from && to ? { from, to } : null,
  };
}

/** The parser for a card's issuer (the card's issuer name): PNB's own layout, else the generic one. */
export function parseCardStatement(text: string, issuer: string): CardStatementParse {
  return issuer === "Punjab National Bank" ? parsePnbCardStatementText(text) : parseCardStatementText(text);
}
