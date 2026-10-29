// Statement reader shared by every statement import: card PDFs now, bank CSV / Excel and bank
// PDFs later (Sprint 9). Parsers work on text already taken out of the file (pdf.js on web), so
// mobile can reuse them. Order on every line: the date, the amount and Dr / Cr are read first;
// only then is the description cleaned, and runs of 4 or more digits are stripped from it, so
// no card or account number (or part of one) leaves the reader. Issues name a line number only,
// never its text. Dates are day first (DD/MM/YYYY), as Indian statements print them.
import { type IsoDate, isIsoDate } from "./dates";
import { stripDigitRuns } from "./digits";
import { MAX_AMOUNT_MINOR, addMinor } from "./money";

/** transactions.note holds at most 280 characters. */
export const STATEMENT_NOTE_MAX = 280;
/** Text taken out of one statement; anything longer is refused, not cut. */
export const MAX_STATEMENT_TEXT_CHARS = 1_000_000;
/** Transaction lines read from one statement; the save step uses the same cap. */
export const MAX_STATEMENT_LINES = 1_000;

export type StatementDirection = "debit" | "credit";

/**
 * purchase, fee, interest and tax are spending on the card; payment, refund and emi are not
 * imported (a refund voids the matching purchase, card EMIs are paid from the loan row).
 */
export type StatementLineKind = "purchase" | "fee" | "interest" | "tax" | "emi" | "payment" | "refund";

export interface StatementLine {
  date: IsoDate;
  /** Positive integer minor units in the statement's own currency (INR for Indian cards). */
  amountMinor: number;
  direction: StatementDirection;
  kind: StatementLineKind;
  /** Cleaned: digit runs stripped, any foreign amount dropped, at most STATEMENT_NOTE_MAX characters. */
  description: string;
  /** ISO code of a foreign-currency purchase ("USD"); its foreign amount is not kept. */
  foreignCurrency: string | null;
  /** 0 for the first of identical lines (same date, amount, direction and description), then 1, 2... */
  occurrence: number;
  /** Running balance after the line, signed (negative: overdrawn), when the statement prints one (bank statements). */
  balanceMinor?: number;
}

export type StatementIssueReason = "no_amount" | "bad_date" | "bad_amount" | "no_description" | "too_many_lines" | "too_long";

/** A line the reader could not use; `line` is its 1-based number in the text (0: the whole text). */
export interface StatementIssue {
  line: number;
  reason: StatementIssueReason;
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function monthFromName(name: string): number | null {
  const word = name.toLowerCase();
  if (word.length < 3) return null;
  const index = MONTH_NAMES.findIndex((full) => full.startsWith(word) || (word === "sept" && full === "september"));
  return index === -1 ? null : index + 1;
}

function isoFromParts(year: number, month: number, day: number): IsoDate | null {
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

const fullYear = (text: string): number => (text.length === 2 ? 2000 + Number(text) : Number(text));

/** One date as statements print it; used at the start of a line and after summary labels. */
export const STATEMENT_DATE_SOURCE =
  String.raw`\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})|\d{1,2}[ -][A-Za-z]{3,9},?[ -](?:\d{4}|\d{2})`;

/**
 * "15/10/2026", "15-10-26", "15.10.2026", "15 Oct 2026", "15-Oct-26", "15 October, 2026" or
 * "2026-10-15" -> "2026-10-15"; null when it is not a real date. Numeric dates are day first;
 * two-digit years are 20YY.
 */
export function parseStatementDate(text: string): IsoDate | null {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})$/.exec(value);
  if (numeric) return isoFromParts(fullYear(numeric[4]!), Number(numeric[3]), Number(numeric[1]));
  const named = /^(\d{1,2})[ -]([A-Za-z]{3,9}),?[ -](\d{4}|\d{2})$/.exec(value);
  if (!named) return null;
  const month = monthFromName(named[2]!);
  return month === null ? null : isoFromParts(fullYear(named[3]!), month, Number(named[1]));
}

/** One amount as statements print it, with an optional Dr / Cr marker. */
export const STATEMENT_AMOUNT_SOURCE =
  String.raw`(?:-?(?:₹|Rs\.?|INR)\s*-?|-)?\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:Dr|Cr)\b\.?)?`;

export interface StatementAmount {
  minor: number;
  /** From a Dr / Cr marker or a minus sign; null when the amount carries neither. */
  direction: StatementDirection | null;
}

/**
 * "1,28,000.50", "₹ 450.00", "Rs. 450", "450.00 Dr", "1,200.00 Cr" or "-1,200.00" -> integer
 * minor units (2 decimal places) and the direction it states; null for anything else, zero or
 * an amount above MAX_AMOUNT_MINOR. A minus sign means a credit.
 */
export function parseStatementAmount(text: string): StatementAmount | null {
  const read = readAmount(text);
  if (!read || read.minor === 0) return null;
  const direction: StatementDirection | null =
    read.marker === "cr" || read.minus ? "credit" : read.marker === "dr" ? "debit" : null;
  return { minor: read.minor, direction };
}

function readAmount(text: string): { minor: number; marker: "dr" | "cr" | null; minus: boolean } | null {
  const m = /^([-+])?\s*(?:₹|Rs\.?|INR)?\s*(-)?(\d{1,3}(?:,\d{2,3})*|\d+)(?:\.(\d{1,2}))?(?:\s*(Dr|Cr)\.?)?$/i.exec(text.trim());
  if (!m) return null;
  const whole = Number(m[3]!.replace(/,/g, ""));
  const minor = whole * 100 + Number((m[4] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) return null;
  const marker = (m[5]?.toLowerCase() ?? null) as "dr" | "cr" | null;
  const minus = m[1] === "-" || m[2] === "-";
  if (marker && minus) return null;
  return { minor, marker, minus };
}

/** A separate Type column: "DR" / "D" / "Debit" or "CR" / "C" / "Credit" (any case); null otherwise. */
export function parseStatementDirection(text: string): StatementDirection | null {
  const value = text.trim().toLowerCase().replace(/\.$/, "");
  if (value === "dr" || value === "d" || value === "debit") return "debit";
  if (value === "cr" || value === "c" || value === "credit") return "credit";
  return null;
}

/**
 * An amount cell with its own Type (DR / CR) column. An empty Type cell falls back to the
 * amount's own marker or sign; null when either cell is unreadable or the two disagree.
 */
export function parseStatementAmountWithType(amountText: string, typeText: string): StatementAmount | null {
  const amount = parseStatementAmount(amountText);
  if (!amount) return null;
  if (typeText.trim() === "") return amount;
  const direction = parseStatementDirection(typeText);
  if (!direction || (amount.direction !== null && amount.direction !== direction)) return null;
  return { minor: amount.minor, direction };
}

/**
 * A running balance cell, signed: "12,000.0", "12,000.00 Cr" and "0.00" are positive or zero;
 * "-250.00" and "250.00 Dr" are overdrawn (negative). Null when unreadable.
 */
export function parseStatementBalance(text: string): number | null {
  const read = readAmount(text);
  if (!read) return null;
  return read.marker === "dr" || read.minus ? -read.minor : read.minor;
}

/** A page footer such as "Date: 29/10/2026 ... Page 2"; parsers drop these rows. */
export function isStatementPageFooter(row: string): boolean {
  return /^\s*Date\s*:.*\bPage\s+\d+\s*(of\s+\d+\s*)?$/i.test(row);
}

// Currencies a foreign card purchase is printed in. A fixed list, so "UPI 123" is never read as one.
const FOREIGN_CURRENCIES = [
  "AED", "AUD", "BDT", "CAD", "CHF", "CNY", "EUR", "GBP", "HKD", "IDR", "JPY", "KRW", "LKR", "MYR",
  "NPR", "NZD", "OMR", "QAR", "SAR", "SEK", "SGD", "THB", "USD", "VND", "ZAR",
];
const FOREIGN_CODE = `(?:${FOREIGN_CURRENCIES.join("|")})`;
const FOREIGN_AMOUNT = new RegExp(
  String.raw`\b(${FOREIGN_CODE})\s*\d[\d,]*(?:\.\d{1,3})?(?!\d)|(?<![\d.,])\d[\d,]*(?:\.\d{1,3})?\s*(${FOREIGN_CODE})\b`,
);

// UPI/DR|CR/<reference>/<payee name>/<bank>/<handle>: only the payee name is kept (the reference,
// bank code and handle, which can hold a phone number, are dropped). Spaces around "/" are allowed
// because a wrapped Remarks cell is joined with a space.
const UPI_REMARKS = /^UPI ?\/ ?(?:DR|CR) ?\/[^/]*\/ ?([^/]*?) ?(?:\/.*)?$/i;

/**
 * The description as it may be stored: for UPI remarks the payee name only; a foreign amount ("USD 12.00") dropped, runs of 4 or
 * more digits stripped, masking ("XXXX", "****") removed, spaces collapsed, at most
 * STATEMENT_NOTE_MAX characters.
 */
export function cleanStatementDescription(raw: string): { description: string; foreignCurrency: string | null } {
  const upi = UPI_REMARKS.exec(raw.replace(/\s+/g, " ").trim());
  if (upi) {
    const payee = cleanStatementDescription(upi[1]!).description;
    return { description: payee === "" ? "UPI" : payee, foreignCurrency: null };
  }
  let text = raw;
  let foreignCurrency: string | null = null;
  const foreign = FOREIGN_AMOUNT.exec(text);
  if (foreign) {
    foreignCurrency = (foreign[1] ?? foreign[2])!;
    text = text.slice(0, foreign.index) + " " + text.slice(foreign.index + foreign[0].length);
  }
  text = stripDigitRuns(text, 4)
    .replace(/[Xx*•]{4,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(text);
  if (chars.length > STATEMENT_NOTE_MAX) text = chars.slice(0, STATEMENT_NOTE_MAX).join("").trimEnd();
  return { description: text, foreignCurrency };
}

const has = (pattern: RegExp, text: string) => pattern.test(text);

/** Kind of a card line from its direction and cleaned description (keywords, case-insensitive). */
export function classifyCardLine(direction: StatementDirection, description: string): StatementLineKind {
  const text = description.toLowerCase();
  if (direction === "credit") {
    if (has(/\bemi\b|\bconver(sion|ted)\b/, text)) return "emi";
    if (has(/\b(payment|paid|thank you|autopay|auto[ -]?debit|neft|imps|rtgs|bbps|upi)\b/, text)) return "payment";
    return "refund";
  }
  if (has(/\b(gst|igst|cgst|sgst|utgst|service tax)\b/, text)) return "tax";
  if (has(/\bemi\b|\bloan on card\b|\bconver(sion|ted)\b/, text)) return "emi";
  if (has(/\binterest\b|\bfinance charges?\b/, text)) return "interest";
  if (has(/\b(fees?|charges?|surcharge|penalty|late payment|over ?limit|annual|membership)\b/, text)) return "fee";
  return "purchase";
}

/** Numbers each line among identical ones (same date, amount, direction, description). */
export function numberOccurrences<T extends Omit<StatementLine, "occurrence">>(lines: readonly T[]): (T & { occurrence: number })[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const key = [line.date, line.amountMinor, line.direction, line.description].join("\u0000");
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return { ...line, occurrence };
  });
}

export type CardLineSkipReason = "payment" | "refund" | "emi" | "before_card" | "future";

/**
 * Whether a parsed card line can be imported: spending (purchase, fee, interest, tax) dated
 * from the day the card was added up to today. Skipped lines are listed to the person, not hidden.
 */
export function cardLineDecision(
  line: Pick<StatementLine, "kind" | "date">,
  { cardAddedOn, today }: { cardAddedOn: IsoDate; today: IsoDate },
): { importable: true } | { importable: false; reason: CardLineSkipReason } {
  if (line.kind === "payment" || line.kind === "refund" || line.kind === "emi") return { importable: false, reason: line.kind };
  if (line.date < cardAddedOn) return { importable: false, reason: "before_card" };
  if (line.date > today) return { importable: false, reason: "future" };
  return { importable: true };
}

/**
 * The text a line's request key is derived from (UUID v5 at the save step): the card, the
 * statement date and the line exactly as parsed. Edits made on the review screen never change
 * it, so the same statement imported again maps to the same keys and saves nothing new.
 */
export function statementLineKeySource(cardId: string, statementDate: IsoDate, line: StatementLine): string {
  return JSON.stringify([
    "card-statement-line:v1", cardId, statementDate, line.date, line.amountMinor,
    line.direction, line.description, line.occurrence,
  ]);
}

export type BalanceOrder = "newest_first" | "oldest_first";

export type BalanceCheck =
  | { status: "ok" }
  /** Fewer than two lines, or a line without a balance: nothing to check against. */
  | { status: "unchecked" }
  /** Indexes (in the order given) of lines whose balance does not follow from the line before it in time. */
  | { status: "broken"; lines: number[] };

/**
 * The statement's self-check: each balance equals the previous balance (in time) plus a credit
 * or minus a debit. `order` is the order the lines are printed in. A broken chain means
 * "Check this statement": the caller shows it and changes no tick on its own.
 */
export function checkBalanceChain(
  lines: readonly Pick<StatementLine, "amountMinor" | "direction" | "balanceMinor">[],
  order: BalanceOrder,
): BalanceCheck {
  if (lines.length < 2 || lines.some((line) => line.balanceMinor === undefined)) return { status: "unchecked" };
  const indexed = lines.map((line, index) => ({ line, index }));
  const inTime = order === "oldest_first" ? indexed : indexed.reverse();
  const broken: number[] = [];
  for (let i = 1; i < inTime.length; i++) {
    const { line, index } = inTime[i]!;
    const signed = line.direction === "credit" ? line.amountMinor : -line.amountMinor;
    if (addMinor(inTime[i - 1]!.line.balanceMinor!, signed) !== line.balanceMinor) broken.push(index);
  }
  broken.sort((a, b) => a - b);
  return broken.length === 0 ? { status: "ok" } : { status: "broken", lines: broken };
}
