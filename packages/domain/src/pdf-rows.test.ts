import { describe, expect, it } from "vitest";
import { type PdfTextItem, linePosition, pageRows, pieceKind, rowLayout, rowText, statementPages, statementTextFromPages } from "./pdf-rows";

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

describe("rowLayout: a masked layout for rows the reader can't use", () => {
  it("names each piece's kind, never its text", () => {
    expect(["21-SEP-2026", "21/09/2026", "1784.00 Dr", "13,854.64", "₹500.00", "0042", "12,000", "FRESH BASKET 4021", "Dr"].map(pieceKind)).toEqual([
      "date", "date", "amount", "amount", "amount", "number", "number", "text", "text",
    ]);
  });

  it("lists pieces left to right with x, width, characters and offset from the top baseline, rounded", () => {
    const layout = rowLayout([item("1784.00 Dr", 520.4, 786.2, 46.6), item("21-SEP-2026", 39.6, 786.2, 52.2), item("FRESH BASKET", 180, 782.9, 60.49)]);
    expect(layout).toBe("date x40 w52 c11 dy0 | text x180 w60 c12 dy3 | amount x520 w47 c10 dy0");
  });

  it("carries no text or digits from the statement, in every line's layout", () => {
    const pieces = [item("21-SEP-2026", 40, 786), item("FRESH BASKET 4021 1234", 110, 786), item("4021", 300, 786), item("1784.00 Dr", 520, 786)];
    const { rowLayouts } = statementPages([pieces, [item("Total Purchase", 40, 800)]]);
    expect(rowLayouts).toHaveLength(2);
    for (const secret of ["FRESH", "SEP", "2026", "4021", "1234", "1784", "Total"]) expect(rowLayouts.join("\n")).not.toContain(secret);
    expect(rowLayouts[1]).toBe("text x40 w70 c14 dy0");
  });

  it("is only kinds and geometry: each piece's numbers are its x, width, characters and offset, never its text", () => {
    // Synthetic pieces whose digits differ from their geometry, so any leaked digit shows.
    const pages = [
      [
        item("07/03/2026", 33, 700, 41, 9),
        item("NEFT/987654321098/A ROY", 88, 700, 97, 9),
        item("Chq 556677", 88, 689, 44, 8),
        item("UPI/ravi@okbank/314159", 210, 700, 93, 9),
        item("2,71,828.18 Cr", 455, 700, 58, 9),
        item("161803", 520, 700, 23, 9),
      ],
      [item("Page 9 of 12", 270, 40, 51, 7), item("A/c 001122334455", 33, 760, 69, 9), item("₹ 4,242.42", 470, 760, 39, 9)],
    ];
    const { rowLayouts } = statementPages(pages);
    const pieces = pages.flat();
    const segments = rowLayouts.flatMap((layout) => layout.split(" | "));
    expect(segments).toHaveLength(pieces.length);
    for (const segment of segments) {
      const m = /^(date|amount|number|text) x(\d+) w(\d+) c(\d+) dy(\d+)$/.exec(segment);
      expect(m, segment).not.toBeNull();
      const [, , x, w, c] = m!.map(Number);
      expect(pieces.some((p) => Math.round(p.x) === x && Math.round(p.width) === w && p.str.replace(/\s+/g, " ").trim().length === c), segment).toBe(true);
    }
    const all = rowLayouts.join("\n");
    for (const secret of ["987654321098", "556677", "ravi", "okbank", "314159", "271828", "161803", "001122334455", "4242", "ROY", "Page"])
      expect(all).not.toContain(secret);
  });
});

describe("pageRows: small print beside a row", () => {
  // Shapes from a real statement's masked layout: ~6.8pt cells, ~1.8pt small print a few points off.
  const cell = (str: string, x: number, y: number, size = 6.8) => item(str, x, y, str.length * size * 0.55, size);
  it("never joins a row, on its baseline or as a fragment, and a short Cr stays on its own row", () => {
    const rows = pageRows([
      cell("08-SEP-2026", 20, 700), cell("SKYLINE TRAVELS", 200, 700), cell("5046.64", 357, 700),
      cell("POINTS EARNED", 424, 696, 1.8), cell("POINTS CREDIT", 425, 693, 1.8),
      cell("REWARD POINTS BALANCE", 421, 690, 1.8),
      cell("10-SEP-2026", 20, 687), cell("PAYMENT RECEIVED", 200, 687), cell("1,500.00", 354, 687), cell("Cr", 392, 687),
    ]).map(rowText);
    expect(rows).toContain("08-SEP-2026 SKYLINE TRAVELS 5046.64");
    expect(rows).toContain("10-SEP-2026 PAYMENT RECEIVED 1,500.00 Cr");
    expect(rows.filter((r) => /POINTS/.test(r))).toHaveLength(3);
  });

  it("joins pieces of the same size, and short pieces whatever their size", () => {
    expect(pageRows([cell("08-SEP-2026", 20, 700), cell("FUEL", 200, 700, 9), cell("Dr", 300, 700, 4)]).map(rowText)).toEqual(["08-SEP-2026 FUEL Dr"]);
  });
});
