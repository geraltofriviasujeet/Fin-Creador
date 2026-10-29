// Text taken out of a statement PDF, as rows for the statement parsers (Sprint 9a.3). A PDF holds
// positioned text pieces, not lines: pieces on the same baseline (within half a line height) form
// a row, top to bottom; within a row they are ordered left to right, and a gap wider than about a
// character starts a new cell (column). Pure, so any client that can list a page's text pieces
// (pdf.js on web) gets the same rows.

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

/** One page's rows, top to bottom. Pieces with no visible text are ignored. */
export function pageRows(items: readonly PdfTextItem[]): PdfRow[] {
  const pieces = items
    .filter((item) => item.str.trim() !== "" && Number.isFinite(item.x) && Number.isFinite(item.y))
    .map((item) => ({ ...item, height: item.height > 0 ? item.height : 10 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: { y: number; height: number; pieces: typeof pieces }[] = [];
  for (const piece of pieces) {
    const row = rows.find((r) => Math.abs(r.y - piece.y) <= Math.max(r.height, piece.height) / 2);
    if (row) row.pieces.push(piece);
    else rows.push({ y: piece.y, height: piece.height, pieces: [piece] });
  }
  rows.sort((a, b) => b.y - a.y);

  return rows.map(({ pieces: rowPieces }) => {
    rowPieces.sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let cell = "";
    let end = -Infinity;
    for (const piece of rowPieces) {
      const gap = piece.x - end;
      if (cell !== "" && gap > piece.height) {
        cells.push(clean(cell));
        cell = piece.str;
      } else {
        cell += cell !== "" && gap > piece.height * 0.15 ? ` ${piece.str}` : piece.str;
      }
      end = Math.max(end, piece.x + piece.width);
    }
    if (clean(cell) !== "") cells.push(clean(cell));
    return { cells };
  });
}

/** A row as the parsers read it: its cells joined by single spaces. */
export const rowText = (row: PdfRow): string => row.cells.join(" ");

/** All pages' rows as statement text (one row per line), page after page. */
export function statementTextFromPages(pages: readonly (readonly PdfTextItem[])[]): string {
  return pages.flatMap((page) => pageRows(page).map(rowText)).join("\n");
}
