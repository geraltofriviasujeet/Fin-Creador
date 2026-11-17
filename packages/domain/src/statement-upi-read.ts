// Which UPI app a statement is from (its header text) and its reader (Sprint 9e). PhonePe's
// "Transaction Statement for" is checked before Google Pay's "Transaction statement", and BHIM's
// Sender / Receiver / Status columns before Paytm (BHIM rows can carry "@paytm" UPI ids).
import { linePosition } from "./pdf-rows";
import { parseBhimStatement, isBhimStatement } from "./statement-upi-bhim";
import { isGooglePayStatement, parseGooglePayStatement } from "./statement-upi-gpay";
import { isPaytmStatement, parsePaytmStatement } from "./statement-upi-paytm";
import { isPhonePeStatement, parsePhonePeStatement } from "./statement-upi-phonepe";
import { type UpiApp, type UpiStatementParse, upiTextRows } from "./statement-upi";

/** The app whose layout the text matches, or null. */
export function detectUpiApp(text: string): UpiApp | null {
  if (isPhonePeStatement(text)) return "phonepe";
  if (isGooglePayStatement(text)) return "google_pay";
  if (isBhimStatement(text)) return "bhim";
  if (isPaytmStatement(text)) return "paytm";
  return null;
}

const READERS = {
  paytm: parsePaytmStatement,
  phonepe: parsePhonePeStatement,
  bhim: parseBhimStatement,
  google_pay: parseGooglePayStatement,
} as const;

/**
 * Reads a UPI app statement: the layout picked from its header, then that app's reader. Null when
 * no layout matches, or when the reader found neither a payment nor a payment it couldn't use.
 */
export function readUpiStatement(read: { text: string; rows?: readonly { cells: readonly string[]; spans?: readonly (readonly [number, number])[] }[] }): UpiStatementParse | null {
  const app = detectUpiApp(read.text);
  if (!app) return null;
  const parse = READERS[app](upiTextRows(read));
  return parse.rows.length > 0 || parse.issues.length > 0 ? parse : null;
}

/** Rows shown in Copy layout when a file can't be read. */
export const UPI_FAILURE_ROWS_SHOWN = 30;

/**
 * For Copy layout when no UPI reader can read a file: which layout was recognised (if any) and the
 * masked layout of its first rows (kinds, positions and sizes; no text or digits from the file).
 */
export function upiReadFailureText(read: { text: string; rowLayouts?: readonly string[]; pageRowCounts?: readonly number[] }): string {
  const app = detectUpiApp(read.text);
  const layouts = read.rowLayouts ?? [];
  const lines = layouts.slice(0, UPI_FAILURE_ROWS_SHOWN).map((layout, i) => {
    const place = read.pageRowCounts ? linePosition(i + 1, read.pageRowCounts) : null;
    return `${place ? `Page ${place.page}, row ${place.row}` : `Row ${i + 1}`}: ${layout || "no layout"}`;
  });
  const head = app ? `Recognised as ${app}, but no payment could be read.` : "No UPI app layout recognised.";
  return [head, ...lines].join("\n");
}
