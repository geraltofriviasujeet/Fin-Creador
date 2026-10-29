import { describe, expect, it } from "vitest";
import { type PdfTextItem, linePosition, pageRows, rowText, statementPages, statementTextFromPages } from "./pdf-rows";

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

// A PNB row with the Network/Last 4 Digit column, as some real statements draw it: the network
// cell and the details are separate pieces at slightly different heights, and the details wrap
// over two lines. Synthetic values only.
describe("pageRows: a row with offset cells and wrapped details", () => {
  const row = (o: { date: number; network: number; line1: number; line2: number; overprint?: boolean }) => [
    item("Transaction Date", 40, 720),
    item("PAYMENT RECEIVED", 260, 706),
    item("18-SEP-2026", 40, 706),
    item("1500.00 Cr", 520, 706),
    item("21-SEP-2026", 40, 692 + o.date),
    item("22-SEP-2026", 110, 692 + o.date),
    item("RUPAY - ####", 180, 692 + o.network, 60),
    item("FRESH BASKET", 260, 692 + o.line1),
    ...(o.overprint ? [item("FRESH BASKET", 260.3, 692 + o.line1)] : []),
    item("STORES BENGAL", 260, 692 + o.line2),
    item("1784.00 Dr", 520, 692 + o.date),
    item("10-OCT-2026", 40, 664),
    item("LATE PAYMENT FEE", 260, 664),
    item("500.00 Dr", 520, 664),
  ];
  it.each([
    ["details on the row's baseline, second line below", { date: 0, network: 2, line1: 0, line2: -10 }],
    ["date centred on two lines of details", { date: 0, network: -1.5, line1: 5, line2: -5 }],
    ["each cell drifting, first line drawn twice", { date: -4, network: 1, line1: 1, line2: -9, overprint: true }],
  ])("%s", (_, offsets) => {
    const text = pageRows(row(offsets)).map(rowText);
    expect(text[0]).toBe("Transaction Date");
    expect(text).toContain("18-SEP-2026 PAYMENT RECEIVED 1500.00 Cr");
    expect(text).toContain("21-SEP-2026 22-SEP-2026 RUPAY - #### FRESH BASKET STORES BENGAL 1784.00 Dr");
    expect(text).toContain("10-OCT-2026 LATE PAYMENT FEE 500.00 Dr");
    expect(text).toHaveLength(4);
  });
});

describe("statementPages and linePosition", () => {
  it("counts each page's rows and places a line on its page", () => {
    const { text, pageRowCounts } = statementPages([[item("A", 40, 800), item("B", 40, 700)], [item("C", 40, 800)]]);
    expect(text).toBe("A\nB\nC");
    expect(pageRowCounts).toEqual([2, 1]);
    expect(linePosition(2, pageRowCounts)).toEqual({ page: 1, row: 2 });
    expect(linePosition(3, pageRowCounts)).toEqual({ page: 2, row: 1 });
    expect(linePosition(4, pageRowCounts)).toBeNull();
  });
});
