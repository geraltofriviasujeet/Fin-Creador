// Parsers for the free end-of-day market files (Sprint 7 data spike):
//   * AMFI NAVAll.txt — every mutual fund scheme's latest NAV, `;`-separated, with AMC and
//     scheme-category heading lines between the data rows.
//   * BSE equity bhavcopy — one row per security traded that day. Two layouts:
//     the UDiFF file from July 2024 (BhavCopy_BSE_CM_0_0_0_<yyyymmdd>_F_0000.CSV) and the
//     older EQ_ISINCODE_<ddmmyy>.CSV.
// Columns are found by header name, so added or reordered columns don't break parsing; a
// missing required column throws (the refresh must fail loudly, not write wrong prices).
// Prices are exact scaled integers (PRICE_SCALE decimals); text with more decimals is rounded
// once, half away from zero. A missing, zero or malformed price becomes null.
// No imports, so the Edge Function can use this file as is.

export const PRICE_SCALE = 4;
const PRICE_FACTOR = 10n ** BigInt(PRICE_SCALE);

/** "1234.56789" -> 12345679n at 4 decimals. Null unless a plain positive decimal. */
export function parsePriceScaled(text: string): bigint | null {
  const match = /^(\d{1,15})(?:\.(\d{1,12}))?$/.exec(text.trim());
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const kept = fraction.slice(0, PRICE_SCALE).padEnd(PRICE_SCALE, "0");
  let scaled = BigInt(whole) * PRICE_FACTOR + BigInt(kept);
  const firstDropped = fraction.charAt(PRICE_SCALE);
  if (firstDropped !== "" && firstDropped >= "5") scaled += 1n; // half away from zero (positive)
  return scaled > 0n ? scaled : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "26-Oct-2026", "28-Jun-24" or "2026-10-26" -> "2026-10-26"; null if not a real date. */
export function parseMarketDate(text: string): string | null {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const named = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(value);
  if (!named) return null;
  const month = MONTHS[(named[2] ?? "").toLowerCase()];
  if (!month) return null;
  const yearText = named[3] ?? "";
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  return isoDate(year, month, Number(named[1]));
}

const ISIN_PATTERN = /^IN[A-Z0-9]{9}\d$/;

/** Trimmed ISIN if it looks like an Indian ISIN; "-", "Redeemed" and junk give null. */
export function cleanIsin(text: string): string | null {
  const value = text.trim().toUpperCase();
  return ISIN_PATTERN.test(value) ? value : null;
}

function splitLines(text: string): string[] {
  return text.replace(/^﻿/, "").split(/\r?\n/);
}

function columnIndex(header: string[], name: string, required: boolean): number {
  const index = header.findIndex((cell) => cell.trim().toLowerCase() === name.toLowerCase());
  if (index < 0 && required) throw new Error(`Market file: column "${name}" not found`);
  return index;
}

function cell(cells: string[], index: number): string {
  return index < 0 ? "" : (cells[index] ?? "").trim();
}

export interface ParseIssue {
  line: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// AMFI NAVAll.txt
// ---------------------------------------------------------------------------

export interface AmfiScheme {
  schemeCode: string;
  /** Valid ISINs from both ISIN columns, in file order, without duplicates (0–2). */
  isins: string[];
  name: string;
  /** "Direct Plan" / "Regular Plan"; null in files without the Plan column. */
  plan: string | null;
  option: string | null;
  /** Heading above the row, e.g. "Open Ended Schemes(Equity Scheme - ELSS)". */
  category: string | null;
  /** AMC heading above the row, e.g. "Axis Mutual Fund". */
  amc: string | null;
  navScaled: bigint | null;
  navDate: string | null;
}

export interface AmfiParseResult {
  schemes: AmfiScheme[];
  issues: ParseIssue[];
}

export function parseAmfiNavAll(text: string): AmfiParseResult {
  const lines = splitLines(text);
  const headerAt = lines.findIndex((line) => line.trim().toLowerCase().startsWith("scheme code;"));
  if (headerAt < 0) throw new Error("Market file: AMFI header not found");
  const header = (lines[headerAt] ?? "").split(";");
  const col = {
    code: columnIndex(header, "Scheme Code", true),
    isinA: columnIndex(header, "ISIN Div Payout/ ISIN Growth", true),
    isinB: columnIndex(header, "ISIN Div Reinvestment", true),
    name: columnIndex(header, "Scheme Name", true),
    plan: columnIndex(header, "Plan", false),
    option: columnIndex(header, "Option", false),
    nav: columnIndex(header, "Net Asset Value", true),
    date: columnIndex(header, "Date", true),
  };

  const schemes: AmfiScheme[] = [];
  const issues: ParseIssue[] = [];
  let category: string | null = null;
  let amc: string | null = null;

  for (let i = headerAt + 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    if (!line.includes(";")) {
      // Scheme-category headings carry "Schemes(...)"; any other text line names an AMC.
      if (/schemes?\s*\(/i.test(line)) category = line;
      else amc = line;
      continue;
    }
    const cells = line.split(";");
    const schemeCode = cell(cells, col.code);
    if (!/^\d+$/.test(schemeCode)) {
      issues.push({ line: i + 1, reason: "scheme code is not a number" });
      continue;
    }
    const isins = [cleanIsin(cell(cells, col.isinA)), cleanIsin(cell(cells, col.isinB))].filter(
      (isin, index, all): isin is string => isin !== null && all.indexOf(isin) === index,
    );
    schemes.push({
      schemeCode,
      isins,
      name: cell(cells, col.name),
      plan: cell(cells, col.plan) || null,
      option: cell(cells, col.option) || null,
      category,
      amc,
      navScaled: parsePriceScaled(cell(cells, col.nav)),
      navDate: parseMarketDate(cell(cells, col.date)),
    });
  }
  return { schemes, issues };
}

// ---------------------------------------------------------------------------
// BSE equity bhavcopy
// ---------------------------------------------------------------------------

export type BseFormat = "udiff" | "legacy";

export interface BseSecurity {
  /** BSE scrip code, e.g. "500002". */
  scripCode: string;
  isin: string | null;
  /** Ticker symbol; the legacy file has none. */
  symbol: string | null;
  /** Name as printed (truncated by BSE: 30 characters, 12 in the legacy file). */
  name: string;
  /** Group / series, e.g. "A", "B", "T", "X"; "F" and "G" are debt and government. */
  series: string;
  /** UDiFF FinInstrmTp ("STK") or legacy SC_TYPE ("Q" equity, "D" debt, "P" preference). */
  instrumentType: string;
  closeScaled: bigint | null;
  tradeDate: string | null;
  /** UDiFF Rmks / legacy TDCLOINDI, the only place a file could flag an event; usually null. */
  remarks: string | null;
}

export interface BseParseResult {
  format: BseFormat;
  securities: BseSecurity[];
  issues: ParseIssue[];
}

/** Comma-separated values with optional double quotes ("" inside quotes is a quote). */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line.charAt(i);
    if (quoted) {
      if (char === '"' && line.charAt(i + 1) === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells;
}

export function parseBseBhavcopy(text: string): BseParseResult {
  const lines = splitLines(text);
  const headerAt = lines.findIndex((line) => line.trim() !== "");
  const header = splitCsvLine(lines[headerAt] ?? "");
  const has = (name: string) => columnIndex(header, name, false) >= 0;
  const format: BseFormat | null = has("FinInstrmId") ? "udiff" : has("SC_CODE") ? "legacy" : null;
  if (!format) throw new Error("Market file: unknown BSE bhavcopy header");

  const col =
    format === "udiff"
      ? {
          code: columnIndex(header, "FinInstrmId", true),
          isin: columnIndex(header, "ISIN", true),
          symbol: columnIndex(header, "TckrSymb", true),
          name: columnIndex(header, "FinInstrmNm", true),
          series: columnIndex(header, "SctySrs", true),
          type: columnIndex(header, "FinInstrmTp", true),
          close: columnIndex(header, "ClsPric", true),
          date: columnIndex(header, "TradDt", true),
          remarks: columnIndex(header, "Rmks", false),
        }
      : {
          code: columnIndex(header, "SC_CODE", true),
          isin: columnIndex(header, "ISIN_CODE", true),
          symbol: -1,
          name: columnIndex(header, "SC_NAME", true),
          series: columnIndex(header, "SC_GROUP", true),
          type: columnIndex(header, "SC_TYPE", true),
          close: columnIndex(header, "CLOSE", true),
          date: columnIndex(header, "TRADING_DATE", true),
          remarks: columnIndex(header, "TDCLOINDI", false),
        };

  const securities: BseSecurity[] = [];
  const issues: ParseIssue[] = [];
  for (let i = headerAt + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    const cells = splitCsvLine(line);
    const scripCode = cell(cells, col.code);
    if (!/^\d+$/.test(scripCode)) {
      issues.push({ line: i + 1, reason: "scrip code is not a number" });
      continue;
    }
    securities.push({
      scripCode,
      isin: cleanIsin(cell(cells, col.isin)),
      symbol: cell(cells, col.symbol) || null,
      name: cell(cells, col.name),
      series: cell(cells, col.series),
      instrumentType: cell(cells, col.type),
      closeScaled: parsePriceScaled(cell(cells, col.close)),
      tradeDate: parseMarketDate(cell(cells, col.date)),
      remarks: cell(cells, col.remarks) || null,
    });
  }
  return { format, securities, issues };
}
