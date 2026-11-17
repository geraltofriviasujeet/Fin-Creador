// UPI app statements (Sprint 9e): Paytm, PhonePe, BHIM and Google Pay. Each layout has its own
// reader (statement-upi-<app>.ts) on the rows the PDF reader gives (statementPages); this file
// holds what they share. Layouts come from the owner's descriptions; fixtures are synthetic.
//
// What a reader keeps from a payment: its date, amount, direction, kind, the payee's name
// (cleaned: anything shaped like a UPI id or email, runs of 4 or more digits and masks removed),
// Paytm's tag, and the person's bank account as the app prints it (bank name and last 2 to 4
// digits; never more). The UPI reference is kept in memory only to derive the request key
// (upiRowKey): two reads of the same statement give the same keys whatever the parser version.
// Never kept: the statement's header (the person's name, phone and email), UPI ids, notes, the
// person's own name on BHIM rows (the other side's name is the payee), times.
import { type IsoDate, addDays, isIsoDate } from "./dates";
import { stripDigitRuns } from "./digits";
import { MAX_AMOUNT_MINOR } from "./money";
import { type StatementDirection, type StatementIssue, STATEMENT_NOTE_MAX, cleanStatementDescription, statementRowShape } from "./statements";
import { uuidV5 } from "./uuid-v5";

export type UpiApp = "paytm" | "phonepe" | "bhim" | "google_pay";

export const UPI_APP_NAMES: Record<UpiApp, string> = { paytm: "Paytm", phonepe: "PhonePe", bhim: "BHIM", google_pay: "Google Pay" };

/** Largest UPI statement PDF read, and the most pages (a year of Paytm is about 190 pages). */
export const MAX_UPI_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_UPI_PDF_PAGES = 250;
/** Payments read from one statement; the save step uses the same cap. */
export const MAX_UPI_ROWS = 3_000;
/** The longest period one statement may cover (a year, leap day included). */
export const MAX_UPI_PERIOD_DAYS = 366;

/**
 * paid (Paid to), sent (Money sent to: a person), received (Received from), recharge (Recharge of),
 * bill (PhonePe Bill paid), cashback (BHIM, from NPCI BHIM), self_transfer (Google Pay, between
 * two of the person's accounts), lite_topup (Google Pay, bank to UPI Lite).
 */
export type UpiRowKind = "paid" | "sent" | "received" | "recharge" | "bill" | "cashback" | "self_transfer" | "lite_topup";

export type UpiRowStatus = "success" | "failed" | "pending";

/** A bank account as the statement names it: the bank's name as printed ("" when none) and its last digits. */
export interface UpiAccountRef {
  bankLabel: string;
  digits: string;
}

export interface UpiRow {
  /** 1-based line in the statement text where the payment starts. */
  line: number;
  date: IsoDate;
  kind: UpiRowKind;
  direction: StatementDirection;
  /** Positive integer minor units (INR). */
  amountMinor: number;
  /** Cleaned payee name; "" for self transfers and top-ups. */
  payee: string;
  /** Paytm's tag as printed ("Food", "Bill Payments"); null elsewhere. */
  tag: string | null;
  /** The person's account the money left or arrived in. */
  account: UpiAccountRef;
  /** Google Pay: paid from UPI Lite (`account` is the bank linked to it). */
  viaLite: boolean;
  /** Google Pay self transfer: the account it went to. */
  toAccount: UpiAccountRef | null;
  status: UpiRowStatus;
  /** The UPI reference (UPI Ref No, UTR, payment id or UPI Transaction ID): for the key only, never stored. */
  ref: string;
}

/** The statement's own totals against the successful payments read. "mismatch": "Check this statement". */
export interface UpiCheck {
  name: "sent_total" | "received_total";
  status: "ok" | "mismatch" | "unchecked";
  foundMinor: number;
  expectedMinor: number | null;
}

/**
 * Payments read against the payments the statement has: the count it prints where it prints one
 * (Paytm's "N Payments made" and "N Payments received"), else every payment start found (read or
 * not), so a short read is plain either way.
 */
export interface UpiCount {
  read: number;
  total: number;
  printed: boolean;
}

/** One account's payments made or received as the statement's summary counts them (Paytm), against those read. */
export interface UpiAccountCount {
  account: UpiAccountRef;
  direction: StatementDirection;
  expected: number;
  found: number;
}

export interface UpiStatementParse {
  app: UpiApp;
  /** As printed in the header; else the first and last payment dates; null when neither. */
  period: { from: IsoDate | null; to: IsoDate | null };
  rows: UpiRow[];
  issues: StatementIssue[];
  checks: UpiCheck[];
  count: UpiCount;
  accountCounts: UpiAccountCount[];
}

/** The count for a parse: `printed` when the statement prints one, else the payments read plus those that couldn't be. */
export const upiCount = (rows: readonly UpiRow[], issues: readonly StatementIssue[], printed: number | null = null): UpiCount => ({
  read: rows.length,
  total: printed ?? rows.length + issues.filter((i) => i.line > 0).length,
  printed: printed !== null,
});

/** A parse with nothing read (the text was too long). */
export const emptyUpiParse = (app: UpiApp): UpiStatementParse => ({
  app,
  period: { from: null, to: null },
  rows: [],
  issues: [{ line: 0, reason: "too_long" }],
  checks: [],
  count: { read: 0, total: 0, printed: false },
  accountCounts: [],
});

/** One row of the PDF (or text line) with its 1-based line number and, from a PDF, each cell's x range. */
export interface UpiTextRow {
  line: number;
  cells: string[];
  spans?: (readonly [number, number])[];
  text: string;
}

/** The statement's rows: PDF rows when given (cells and their x ranges kept), else text lines as one cell each. */
export function upiTextRows(read: { text: string; rows?: readonly { cells: readonly string[]; spans?: readonly (readonly [number, number])[] }[] }): UpiTextRow[] {
  if (read.rows) {
    return read.rows.map((r, i) => {
      const kept = r.cells.map((c, k) => ({ c: c.trim(), span: r.spans?.[k] })).filter((x) => x.c !== "");
      const spans = kept.every((x) => x.span) ? kept.map((x) => x.span!) : undefined;
      return { line: i + 1, cells: kept.map((x) => x.c), ...(spans ? { spans } : {}), text: r.cells.join(" ") };
    });
  }
  return read.text.split(/\r?\n/).map((t, i) => ({ line: i + 1, cells: t.trim() === "" ? [] : [t.trim()], text: t }));
}

/** A cell of a payment block, with its row and x range (when known). */
export interface UpiCell {
  text: string;
  line: number;
  span?: readonly [number, number];
}

/** A block's cells in reading order, page furniture dropped. */
export const upiCells = (block: readonly UpiTextRow[]): UpiCell[] =>
  block.flatMap((r) => r.cells.map((text, k) => ({ text, line: r.line, ...(r.spans?.[k] ? { span: r.spans[k] } : {}) }))).filter((c) => !isUpiPageFurniture(c.text));

/** x ranges overlap. */
export const sameColumn = (a: UpiCell, b: UpiCell): boolean => !!a.span && !!b.span && a.span[0] < b.span[1] && b.span[0] < a.span[1];

/** A time of day ("10:24 PM", "22:05:31"): read past, never kept. */
export const isUpiTime = (cell: string): boolean => /^\d{1,2}:\d{2}(?::\d{2})?\s?(?:[AaPp]\.?[Mm]\.?)?$/.test(cell.trim());

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Oct", "October", "Sept" -> 10, 10, 9; null for anything else. */
function month(name: string): number | null {
  const word = name.toLowerCase().replace(/\.$/, "");
  if (word.length < 3) return null;
  const i = MONTHS.findIndex((full) => full.startsWith(word) || (word === "sept" && full === "september"));
  return i === -1 ? null : i + 1;
}

function iso(year: number, m: number, day: number): IsoDate | null {
  const value = `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isIsoDate(value) ? value : null;
}

const year4 = (text: string) => (text.length === 2 ? 2000 + Number(text) : Number(text));

/** A date with its year: "12 Oct 2026", "12 Oct, 2026", "12 Oct'26", "01 October 2026", "Oct 12, 2026", "12/10/2026". */
export function parseUpiDate(text: string): IsoDate | null {
  const t = text.trim().replace(/\s+/g, " ");
  let m = /^(\d{1,2}) ([A-Za-z]{3,9})\.?(?:,? |\s?['’])(\d{4}|\d{2})$/.exec(t);
  if (m) {
    const mo = month(m[2]!);
    return mo === null ? null : iso(year4(m[3]!), mo, Number(m[1]));
  }
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (m) {
    const mo = month(m[1]!);
    return mo === null ? null : iso(Number(m[3]), mo, Number(m[2]));
  }
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** "12 Oct" (no year): the day and month, or null. */
export function parseUpiDayMonth(text: string): { month: number; day: number } | null {
  const m = /^(\d{1,2}) ([A-Za-z]{3,9})\.?$/.exec(text.trim().replace(/\s+/g, " "));
  if (!m) return null;
  const mo = month(m[2]!);
  const day = Number(m[1]);
  return mo === null || day < 1 || day > 31 ? null : { month: mo, day };
}

/**
 * The year of a day printed without one: the one that puts it inside the statement's period (a
 * day either side allowed); null when no period is known or none fits.
 */
export function dateInPeriod(dm: { month: number; day: number }, period: { from: IsoDate | null; to: IsoDate | null }): IsoDate | null {
  if (!period.from || !period.to) return null;
  const lo = addDays(period.from, -1);
  const hi = addDays(period.to, 1);
  for (let y = Number(hi.slice(0, 4)); y >= Number(lo.slice(0, 4)); y--) {
    const d = iso(y, dm.month, dm.day);
    if (d && d >= lo && d <= hi) return d;
  }
  return null;
}

/** "a - b" or "a to b", each a date with its year; null unless both read and in order. */
export function parseUpiPeriod(text: string): { from: IsoDate; to: IsoDate } | null {
  const m = PERIOD.exec(text.replace(/\s+/g, " "));
  if (!m) return null;
  const from = parseUpiDate(m[1]!);
  const to = parseUpiDate(m[2]!);
  return from && to && from <= to ? { from, to } : null;
}

const DATE_SOURCE = String.raw`\d{1,2} [A-Za-z]{3,9}\.?(?:,? |\s?['’])(?:\d{4}|\d{2})|[A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4}`;
const PERIOD = new RegExp(String.raw`(?<![\w'’])(${DATE_SOURCE})\s*(?:-|–|to)\s*(${DATE_SOURCE})(?![\w'’])`, "i");

/** "Rs.1,234.50", "Rs 65", "INR 139.00", "₹2,56,640.60", "139.00" -> minor units; null for anything else or zero. */
export function parseUpiAmount(text: string): number | null {
  const m = /^(?:₹|Rs\.?|INR)?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?$/i.exec(text.trim());
  if (!m) return null;
  const minor = Number(m[1]!.replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor > 0 && minor <= MAX_AMOUNT_MINOR ? minor : null;
}

const MAX_PAYEE = 80;

/**
 * A payee name as it may be stored and sent: anything shaped like a UPI id or email (x@y) removed,
 * runs of 4 or more digits and masks stripped (cleanStatementDescription), spaces collapsed.
 */
export function cleanUpiPayee(raw: string): string {
  const noHandles = raw.replace(/\S+@\S+/g, " ");
  const cleaned = cleanStatementDescription(stripDigitRuns(noHandles, 4)).description.replace(/^[\s,.:;|-]+|[\s,.:;|-]+$/g, "");
  return Array.from(cleaned).slice(0, Math.min(MAX_PAYEE, STATEMENT_NOTE_MAX)).join("").trim();
}

/** A bank name as stored for matching: no digits, lower case, spaces collapsed. */
export const upiBankLabelKey = (label: string): string =>
  label.replace(/[0-9]/g, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);

/** "State Bank Of India - 12", "XX1234", "State Bank of India 1234" -> bank name and digits (the last 2 to 4). */
export function parseUpiAccount(text: string, style: "dash" | "space" | "masked"): UpiAccountRef | null {
  const t = text.replace(/\s+/g, " ").trim();
  const m =
    style === "dash" ? /^(.*?[A-Za-z].*?)\s*-\s*(\d{2,4})$/.exec(t)
    : style === "space" ? /^(.*?[A-Za-z][^0-9]*?)\s+[Xx*•]*(\d{2,4})$/.exec(t)
    : /^(?:(.*?[A-Za-z][^0-9]*?)\s+)?[Xx*•]+(\d{2,4})$/.exec(t);
  if (!m) return null;
  const bankLabel = (m[1] ?? "").replace(/[0-9]/g, "").replace(/\s+/g, " ").trim();
  if (bankLabel.length > 80) return null;
  return { bankLabel, digits: m[2]! };
}

/** A failed or pending payment, when one of its cells says so. */
export function upiStatusOf(cells: readonly string[]): UpiRowStatus {
  for (const c of cells) {
    if (/^(?:failed|failure|declined|cancelled|canceled|reversed)$/i.test(c.trim())) return "failed";
    if (/^(?:pending|processing|in progress)$/i.test(c.trim())) return "pending";
  }
  return "success";
}

/** The reference as keyed: letters and digits only, upper case. */
const refKey = (ref: string) => ref.replace(/[^0-9A-Za-z]/g, "").toUpperCase();

export const UPI_ROW_KEY_NAMESPACE = "7b1e4c2a-5d3f-4e8a-b9c6-0a1d2e3f4b5c";

/**
 * A payment's request key: UUID v5 of its UPI reference and direction (the payer's and the payee's
 * sides of one payment differ). Edits on the review screen never change it, and nor does the
 * parser version, so the same statement imported again adds nothing.
 */
export const upiRowKey = (row: Pick<UpiRow, "ref" | "direction">): string =>
  uuidV5(JSON.stringify(["upi-row:v1", refKey(row.ref), row.direction]), UPI_ROW_KEY_NAMESPACE);

/** A payment start the reader couldn't use: its line and masked shape (no text or numbers). */
export const upiIssue = (row: UpiTextRow, reason: StatementIssue["reason"]): StatementIssue => ({ line: row.line, reason, shape: statementRowShape(row.text) });

/** The statement's totals against the successful payments read. */
export function upiChecks(rows: readonly UpiRow[], totals: { sentMinor: number | null; receivedMinor: number | null }): UpiCheck[] {
  const sum = (d: StatementDirection) => rows.filter((r) => r.status === "success" && r.direction === d).reduce((a, r) => a + r.amountMinor, 0);
  const check = (name: UpiCheck["name"], found: number, expected: number | null): UpiCheck => ({
    name,
    status: expected === null ? "unchecked" : found === expected ? "ok" : "mismatch",
    foundMinor: found,
    expectedMinor: expected,
  });
  return [check("sent_total", sum("debit"), totals.sentMinor), check("received_total", sum("credit"), totals.receivedMinor)];
}

/** The period printed, else the first and last payment dates. */
export function upiPeriod(printed: { from: IsoDate; to: IsoDate } | null, rows: readonly UpiRow[]): { from: IsoDate | null; to: IsoDate | null } {
  if (printed) return printed;
  const dates = rows.map((r) => r.date).sort();
  return { from: dates[0] ?? null, to: dates.at(-1) ?? null };
}

/** Days the period covers, both ends included; null when unknown. */
export function upiPeriodDays(period: { from: IsoDate | null; to: IsoDate | null }): number | null {
  if (!period.from || !period.to) return null;
  const ms = Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Splits rows into payment blocks: each starts at a row whose cell `isStart` accepts, and takes the
 * rows up to the next start. Rows before the first start (the header) are returned apart.
 */
export function upiBlocks(rows: readonly UpiTextRow[], isStart: (row: UpiTextRow) => boolean): { header: UpiTextRow[]; blocks: UpiTextRow[][] } {
  const header: UpiTextRow[] = [];
  const blocks: UpiTextRow[][] = [];
  for (const row of rows) {
    if (row.cells.length === 0) continue;
    if (isStart(row)) blocks.push([row]);
    else if (blocks.length === 0) header.push(row);
    else blocks[blocks.length - 1]!.push(row);
  }
  return { header, blocks };
}

/** Rows that repeat on every page or close a page: never part of a payment. */
export const isUpiPageFurniture = (cell: string): boolean =>
  /^(?:page \d+(?: of \d+)?|\d+ ?\/ ?\d+|date ?(?:&|and) ?time|transaction details|notes ?& ?tags|your account|amount|date|details|type)$/i.test(cell.trim());
