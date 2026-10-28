import { describe, expect, it } from "vitest";
import { CSV_BOM, type CsvCell, csvText, guardCsvText, toCsv } from "./csv";

/** RFC 4180 reader for the tests (quoted fields, doubled quotes, CRLF). */
function parseCsv(file: string): string[][] {
  expect(file.startsWith(CSV_BOM)).toBe(true);
  const text = file.slice(CSV_BOM.length);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    }
    else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  expect(cell).toBe("");
  expect(row).toEqual([]);
  return rows;
}

describe("toCsv", () => {
  it("BOM, CRLF, header first; quotes commas, quotes and line breaks", () => {
    const file = toCsv(["Date", "Note"], [["2026-10-28", csvText('Lunch, "team"\nday')]]);
    expect(file).toBe(`${CSV_BOM}Date,Note\r\n2026-10-28,"Lunch, ""team""\nday"\r\n`);
    expect(parseCsv(file)).toEqual([["Date", "Note"], ["2026-10-28", 'Lunch, "team"\nday']]);
  });

  it("neutralises formulas in text cells only; generated amounts stay numbers", () => {
    const file = toCsv(
      ["Amount", "Note", "Account"],
      [
        ["-12.50", csvText('=HYPERLINK("http://example.test","x")'), csvText("+91 savings")],
        ["0.50", csvText("@SUM(A1)"), csvText("\tTab bank")],
        ["007.00", csvText("-minus"), csvText("\rCR bank")],
      ],
    );
    const rows = parseCsv(file);
    expect(rows.slice(1).map((r) => r[0])).toEqual(["-12.50", "0.50", "007.00"]);
    expect(rows.slice(1).map((r) => r[1])).toEqual(["'=HYPERLINK(\"http://example.test\",\"x\")", "'@SUM(A1)", "'-minus"]);
    expect(rows.slice(1).map((r) => r[2])).toEqual(["'+91 savings", "'\tTab bank", "'\rCR bank"]);
  });

  it("leaves ordinary text and an empty note alone", () => {
    expect(guardCsvText("Groceries")).toBe("Groceries");
    expect(guardCsvText("a=b")).toBe("a=b");
    expect(guardCsvText("")).toBe("");
    expect(parseCsv(toCsv(["Note"], [[csvText(null)]]))[1]).toEqual([""]);
  });

  it("property: parsing the file gives back every cell, with the guard on text cells only", () => {
    let seed = 0x8c2026;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const alphabet = ['=', '+', '-', '@', '\t', '\r', '\n', '"', ',', ' ', 'a', 'Z', '0', '9', '₹', 'é', 'अ', "'", ';'];
    const word = () => Array.from({ length: Math.floor(rand() * 8) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
    for (let run = 0; run < 300; run++) {
      const header = ["A", "B", "C"];
      const rows: CsvCell[][] = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => header.map(() => (rand() < 0.5 ? word() : csvText(word()))));
      const parsed = parseCsv(toCsv(header, rows));
      expect(parsed[0]).toEqual(header);
      const expected = rows.map((r) => r.map((c) => (typeof c === "string" ? c : guardCsvText(c.text))));
      expect(parsed.slice(1), `run ${run}`).toEqual(expected);
      for (const [i, r] of rows.entries())
        for (const [j, c] of r.entries()) if (typeof c !== "string") expect(/^[=+\-@\t\r]/.test(parsed[i + 1]![j]!)).toBe(false);
    }
  });
});
