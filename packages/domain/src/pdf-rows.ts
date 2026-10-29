// Text taken out of a statement PDF, as rows for the statement parsers (Sprint 9a.3). A PDF holds
// positioned text pieces, not lines: pieces on the same baseline (within half a line height) form
// a row, top to bottom. A table cell can hold more than one line (wrapped details) or sit a little
// above or below the rest of its row (a Network/Last 4 Digit cell, a date centred on two lines of
// details), so a row that starts clearly to the right of a row just above or below it (within
// about one and a half line heights) is a fragment of that row and is merged into the nearer one.
// Within a row, pieces whose x ranges overlap form a column, read top line first; columns are read
// left to right, and a gap wider than about a character starts a new cell. A piece drawn twice at
// the same place (overprinted text) is read once. Pure, so any client that can list a page's text
// pieces (pdf.js on web) gets the same rows.

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
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

type Piece = PdfTextItem;
type Band = { y: number; height: number; pieces: Piece[] };

/** Pieces on one baseline (within half a line height), top to bottom. */
function baselines(pieces: readonly Piece[]): Band[] {
  const bands: Band[] = [];
  for (const piece of [...pieces].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const band = bands.find((r) => Math.abs(r.y - piece.y) <= Math.max(r.height, piece.height) / 2);
    if (band) band.pieces.push(piece);
    else bands.push({ y: piece.y, height: piece.height, pieces: [piece] });
  }
  return bands.sort((a, b) => b.y - a.y);
}

const leftOf = (band: Band) => Math.min(...band.pieces.map((p) => p.x));
const distance = (a: Band, b: Band) => Math.min(...a.pieces.flatMap((p) => b.pieces.map((q) => Math.abs(p.y - q.y))));

/** Merges each fragment (a band starting clearly right of a band next to it) into the nearer such band. */
function mergeFragments(bands: Band[]): Band[] {
  const h = (band: Band) => band.height;
  const hosts = (band: Band) =>
    bands.filter((other) => other !== band && distance(band, other) <= 1.6 * Math.max(h(band), h(other)) && leftOf(other) < leftOf(band) - h(band));
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

function rowCells(pieces: readonly Piece[]): string[] {
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
  let cell = "";
  let end = -Infinity;
  for (const column of columns.map(columnText)) {
    const gap = column.start - end;
    if (cell !== "" && gap > column.height) {
      cells.push(clean(cell));
      cell = column.text;
    } else cell += cell !== "" && gap > column.height * 0.15 ? ` ${column.text}` : column.text;
    end = Math.max(end, column.end);
  }
  if (clean(cell) !== "") cells.push(clean(cell));
  return cells;
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
  return mergeFragments(baselines(pieces)).map((band) => ({ cells: rowCells(band.pieces) }));
}

/** A row as the parsers read it: its cells joined by single spaces. */
export const rowText = (row: PdfRow): string => row.cells.join(" ");

/** All pages' rows as statement text (one row per line), page after page. */
export function statementTextFromPages(pages: readonly (readonly PdfTextItem[])[]): string {
  return statementPages(pages).text;
}

/** The statement text and how many of its rows (lines) each page gave, to say where a line is. */
export function statementPages(pages: readonly (readonly PdfTextItem[])[]): { text: string; pageRowCounts: number[] } {
  const rows = pages.map((page) => pageRows(page).map(rowText));
  return { text: rows.flat().join("\n"), pageRowCounts: rows.map((r) => r.length) };
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
