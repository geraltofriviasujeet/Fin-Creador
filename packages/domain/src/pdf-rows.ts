// Text taken out of a statement PDF, as rows for the statement parsers (Sprint 9a.3). A PDF holds
// positioned text pieces, not lines: pieces on the same baseline (within half a line height) form
// a row, top to bottom. A table cell can hold more than one line (wrapped details) or sit a little
// above or below the rest of its row (a Network/Last 4 Digit cell, a date centred on two lines of
// details), so a row that starts clearly to the right of a row just above or below it (within
// about one and a half line heights) is a fragment of that row and is merged into the nearer one.
// Within a row, pieces whose x ranges overlap form a column, read top line first; columns are read
// left to right, and a gap wider than about a character starts a new cell. A piece drawn twice at
// the same place (overprinted text) is read once. Small print (a piece of 3+ characters whose
// width per character is under half, or over twice, a row's) never joins that row, on its baseline
// or as a fragment: it forms rows of its own, so it can't land after a line's amount. Pure, so any
// client that can list a page's text pieces (pdf.js on web) gets the same rows.
import { parseStatementDate } from "./statements";

/** Largest statement PDF read (bytes), and the most pages. */
export const MAX_STATEMENT_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_STATEMENT_PDF_PAGES = 30;

/** One positioned text piece: x, y of its baseline start in PDF units (y grows upwards). */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfRow {
  /** Cells left to right; spaces inside a cell are kept as single spaces. */
  cells: string[];
  /** Each cell's x range (start, end) in PDF units, to place it under a column header. */
  spans: [number, number][];
  /** The row's pieces, masked (rowLayout): no text or digits from the statement. */
  layout: string;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

type Piece = PdfTextItem;
/** The band's type size, as width per character of its first piece of 3+ characters; null until one. */
type Band = { y: number; height: number; advance: number | null; pieces: Piece[] };

/** Width per character, a measure of type size; null for pieces too short to tell (1–2 characters). */
function advance(piece: Piece): number | null {
  const chars = clean(piece.str).length;
  return chars >= 3 && piece.width > 0 ? piece.width / chars : null;
}

/** Same type size within a factor of 2 (or one side can't tell). */
const sameSize = (a: number | null, b: number | null) => a === null || b === null || Math.max(a, b) <= 2 * Math.min(a, b);

/** Pieces on one baseline (within half a line height) and of the same type size, top to bottom. */
function baselines(pieces: readonly Piece[]): Band[] {
  const bands: Band[] = [];
  for (const piece of [...pieces].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const size = advance(piece);
    // The nearest such baseline: a short piece ("Cr") sits on its own row's, not on small print's beside it.
    const band = bands
      .filter((r) => Math.abs(r.y - piece.y) <= Math.max(r.height, piece.height) / 2 && sameSize(r.advance, size))
      .sort((a, b) => Math.abs(a.y - piece.y) - Math.abs(b.y - piece.y))[0];
    if (band) {
      band.pieces.push(piece);
      band.advance ??= size;
    } else bands.push({ y: piece.y, height: piece.height, advance: size, pieces: [piece] });
  }
  return bands.sort((a, b) => b.y - a.y);
}

const leftOf = (band: Band) => Math.min(...band.pieces.map((p) => p.x));
const distance = (a: Band, b: Band) => Math.min(...a.pieces.flatMap((p) => b.pieces.map((q) => Math.abs(p.y - q.y))));

/** Merges each fragment (a band starting clearly right of a band next to it) into the nearer such band. */
function mergeFragments(bands: Band[]): Band[] {
  const h = (band: Band) => band.height;
  const hosts = (band: Band) =>
    bands.filter(
      (other) =>
        other !== band &&
        sameSize(band.advance, other.advance) &&
        distance(band, other) <= 1.6 * Math.max(h(band), h(other)) &&
        leftOf(other) < leftOf(band) - h(band),
    );
  const fragment = new Set(bands.filter((band) => hosts(band).length > 0));
  for (const band of fragment) {
    const host = hosts(band)
      .filter((other) => !fragment.has(other))
      .sort((a, b) => distance(band, a) - distance(band, b) || b.y - a.y)[0];
    if (!host) {
      fragment.delete(band);
      continue;
    }
    host.pieces.push(...band.pieces);
  }
  return bands.filter((band) => !fragment.has(band));
}

/** A column's text: its baselines top to bottom, each left to right, joined with spaces. */
function columnText(pieces: readonly Piece[]): { text: string; start: number; end: number; height: number } {
  const lines = baselines(pieces).map((band) => {
    const sorted = [...band.pieces].sort((a, b) => a.x - b.x);
    let text = "";
    let end = -Infinity;
    for (const piece of sorted) {
      text += text !== "" && piece.x - end > piece.height * 0.15 ? ` ${piece.str}` : piece.str;
      end = Math.max(end, piece.x + piece.width);
    }
    return text;
  });
  return {
    text: lines.join(" "),
    start: Math.min(...pieces.map((p) => p.x)),
    end: Math.max(...pieces.map((p) => p.x + p.width)),
    height: Math.max(...pieces.map((p) => p.height)),
  };
}

function rowCells(pieces: readonly Piece[]): { cells: string[]; spans: [number, number][] } {
  // Columns: pieces whose x ranges overlap (a wrapped cell's lines), left to right.
  const columns: Piece[][] = [];
  let columnEnd = -Infinity;
  for (const piece of [...pieces].sort((a, b) => a.x - b.x || b.y - a.y)) {
    if (columns.length > 0 && piece.x < columnEnd - 0.01) {
      columns[columns.length - 1]!.push(piece);
      columnEnd = Math.max(columnEnd, piece.x + piece.width);
    } else {
      columns.push([piece]);
      columnEnd = piece.x + piece.width;
    }
  }
  const cells: string[] = [];
  const spans: [number, number][] = [];
  let cell = "";
  let start = 0;
  let end = -Infinity;
  for (const column of columns.map(columnText)) {
    const gap = column.start - end;
    if (cell !== "" && gap > column.height) {
      cells.push(clean(cell));
      spans.push([start, end]);
      cell = column.text;
      start = column.start;
    } else {
      if (cell === "") start = column.start;
      cell += cell !== "" && gap > column.height * 0.15 ? ` ${column.text}` : column.text;
    }
    end = Math.max(end, column.end);
  }
  if (clean(cell) !== "") {
    cells.push(clean(cell));
    spans.push([start, end]);
  }
  return { cells, spans };
}

/** What a piece looks like, never what it says: a date, an amount (with a decimal part), a number, or text. */
export function pieceKind(text: string): "date" | "amount" | "number" | "text" {
  const t = clean(text);
  if (parseStatementDate(t)) return "date";
  if (/^-?(?:₹|Rs\.?|INR)?\s?\d[\d,]*\.\d{1,2}(?:\s?(?:Dr|Cr)\.?)?$/i.test(t)) return "amount";
  if (/^[\d,./\s-]+$/.test(t)) return "number";
  return "text";
}

/**
 * A row's layout for diagnosing a row the reader couldn't use, masked: per piece left to right,
 * its kind, x start, width, characters, and baseline offset from the row's top piece (dy, down is
 * positive), all rounded. E.g. "date x40 w52 c11 dy0 | text x110 w180 c24 dy0". No text or digits
 * from the statement.
 */
export function rowLayout(pieces: readonly PdfTextItem[]): string {
  const top = Math.max(...pieces.map((p) => p.y));
  return [...pieces]
    .sort((a, b) => a.x - b.x || b.y - a.y)
    .map((p) => `${pieceKind(p.str)} x${Math.round(p.x)} w${Math.round(p.width)} c${clean(p.str).length} dy${Math.round(top - p.y)}`)
    .join(" | ");
}

/** One page's rows, top to bottom. Pieces with no visible text are ignored. */
export function pageRows(items: readonly PdfTextItem[]): PdfRow[] {
  const pieces: Piece[] = [];
  for (const item of items) {
    if (item.str.trim() === "" || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    const piece = { ...item, height: item.height > 0 ? item.height : 10 };
    if (pieces.some((p) => p.str === piece.str && Math.abs(p.x - piece.x) < 1 && Math.abs(p.y - piece.y) < 1)) continue;
    pieces.push(piece);
  }
  return mergeFragments(baselines(pieces)).map((band) => ({ ...rowCells(band.pieces), layout: rowLayout(band.pieces) }));
}

/** A row as the parsers read it: its cells joined by single spaces. */
export const rowText = (row: PdfRow): string => row.cells.join(" ");

/** All pages' rows as statement text (one row per line), page after page. */
export function statementTextFromPages(pages: readonly (readonly PdfTextItem[])[]): string {
  return statementPages(pages).text;
}

/**
 * The statement text, how many of its rows (lines) each page gave, to say where a line is, each
 * line's masked layout (rowLayout), and each line's cells with their x ranges (the generic bank
 * reader places them under the column headers), in text order.
 */
export function statementPages(pages: readonly (readonly PdfTextItem[])[]): {
  text: string;
  pageRowCounts: number[];
  rowLayouts: string[];
  rows: { cells: string[]; spans: [number, number][] }[];
} {
  const rows = pages.map((page) => pageRows(page));
  return {
    text: rows.flat().map(rowText).join("\n"),
    pageRowCounts: rows.map((r) => r.length),
    rowLayouts: rows.flat().map((r) => r.layout),
    rows: rows.flat().map(({ cells, spans }) => ({ cells, spans })),
  };
}

/** Where a 1-based line of the statement text is: its page and its row on that page (both 1-based). */
export function linePosition(line: number, pageRowCounts: readonly number[]): { page: number; row: number } | null {
  let row = line;
  for (const [i, count] of pageRowCounts.entries()) {
    if (row >= 1 && row <= count) return { page: i + 1, row };
    row -= count;
  }
  return null;
}
