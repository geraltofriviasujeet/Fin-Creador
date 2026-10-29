import { describe, expect, it } from "vitest";
import { type PdfTextItem, pageRows, rowText, statementTextFromPages } from "./pdf-rows";

const item = (str: string, x: number, y: number, width = str.length * 5, height = 9): PdfTextItem => ({ str, x, y, width, height });

describe("pageRows", () => {
  it("orders rows top to bottom and cells left to right, whatever order the pieces come in", () => {
    const rows = pageRows([
      item("1784.00 Dr", 520, 786),
      item("21-SEP-2026", 40, 786),
      item("Invoice Date", 40, 800),
      item("FRESH BASKET", 180, 786),
    ]);
    expect(rows.map((r) => r.cells)).toEqual([["Invoice Date"], ["21-SEP-2026", "FRESH BASKET", "1784.00 Dr"]]);
  });

  it("puts pieces within half a line height on one row (a baseline that drifts)", () => {
    expect(pageRows([item("A", 40, 700), item("B", 200, 703.5), item("C", 40, 690)]).map(rowText)).toEqual(["A B", "C"]);
  });

  it("joins pieces of one word, keeps spaces between words, and starts a cell at a wide gap", () => {
    const rows = pageRows([
      item("FRESH", 40, 500, 25),
      item("BAS", 65, 500, 15),
      item("KET", 80, 500, 15),
      item("STORES", 97, 500, 30),
      item("450.00 Dr", 400, 500),
    ]);
    expect(rows[0]!.cells).toEqual(["FRESHBASKET STORES", "450.00 Dr"]);
  });

  it("ignores blank pieces and collapses spaces", () => {
    expect(pageRows([item("  ", 40, 500), item(" A  B ", 60, 500)]).map(rowText)).toEqual(["A B"]);
    expect(pageRows([])).toEqual([]);
  });
});

describe("statementTextFromPages", () => {
  it("runs page after page, one row per line", () => {
    expect(statementTextFromPages([[item("P1 top", 40, 800), item("P1 end", 40, 100)], [item("P2", 40, 800)]])).toBe("P1 top\nP1 end\nP2");
  });
});
