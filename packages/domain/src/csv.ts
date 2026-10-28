// CSV files (Sprint 8c export): UTF-8 with a byte-order mark (so spreadsheet apps read ₹ and
// other scripts correctly), CRLF line endings, RFC 4180 quoting.
//   Formula injection: a text cell the person typed or named (account, category, payment mode,
//   note) that starts with = + - @, a tab or a carriage return gets a leading apostrophe, so a
//   spreadsheet shows it as text instead of running it. Cells the app generates itself (dates,
//   amounts, currency codes, fixed words) are never guarded: a negative or leading-zero amount
//   stays a number.

export const CSV_BOM = "﻿";

/** A cell from the person's own words: guarded against formula injection. */
export interface CsvText {
  text: string;
}
/** A cell the app writes itself (a date, an amount, a code): written as it is. */
export type CsvCell = string | CsvText;

export const csvText = (text: string | null | undefined): CsvText => ({ text: text ?? "" });

const FORMULA_START = /^[=+\-@\t\r]/;

/** The text as a spreadsheet will see it: with a leading apostrophe if it could start a formula. */
export function guardCsvText(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;
}

export function csvCellValue(cell: CsvCell): string {
  return typeof cell === "string" ? cell : guardCsvText(cell.text);
}

/** The whole file: BOM, the header row, then each row; every line ends with CRLF. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const line = (cells: readonly CsvCell[]) => cells.map((c) => quote(csvCellValue(c))).join(",");
  return CSV_BOM + [header, ...rows].map(line).join("\r\n") + "\r\n";
}
