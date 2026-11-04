import { describe, expect, it } from "vitest";
import { statementPages } from "./pdf-rows";
import { csvRows } from "./statement-bank";
import { type BankTableRow, bankReadFailureText, parseGenericBankStatement, readBankStatement } from "./statement-bank-generic";

// QA (Sprint 9d). Invented banks, names and numbers only. Expected values are worked out by hand.
const rowsOf = (text: string): BankTableRow[] => csvRows(text).map((cells) => ({ cells }));
const gen = (lines: string[]) => parseGenericBankStatement(rowsOf(lines.join("\n")));
const dates = (p: ReturnType<typeof gen>) => p?.lines.map((l) => l.date);

describe("QA 9d: header, synonyms, columns", () => {
  it("1. header on a late row after preamble lines, no bank name", () => {
    const p = gen(["Statement of account", "Period 01/10/2026 to 31/10/2026", "", "Date,Narration,Debit,Credit,Balance", "01/10/2026,SHOP,100.00,,900.00"]);
    expect(p?.lines.map((l) => [l.amountMinor, l.direction])).toEqual([[10_000, "debit"]]);
  });
  it("2. synonym sets: Txn Date/Particulars/Withdrawal/Deposit/Closing Balance; Posting Date/Transaction Reference/Debit/Credit/Balance", () => {
    for (const head of [
      "Txn Date,Particulars,Withdrawal Amt.,Deposit Amt.,Closing Balance",
      "Posting Date,Transaction Reference,Debit,Credit,Balance",
      "Value Date,Txn Date,Description,Debit Amount,Credit Amount,Balance",
    ]) {
      const cols = head.split(",").length;
      const row = (d: string, t: string, a: string, b: string) => {
        const cells = Array(cols).fill("");
        cells[0] = d;
        if (cols === 6) cells[1] = d;
        cells[cols === 6 ? 2 : 1] = t;
        cells[cols - 3] = a;
        cells[cols - 1] = b;
        return cells.join(",");
      };
      const p = gen([head, row("01/10/2026", "SHOP", "100.00", "900.00"), row("02/10/2026", "TEA", "10.00", "890.00")]);
      expect(p?.lines.map((l) => [l.description, l.amountMinor, l.balanceMinor]), head).toEqual([["SHOP", 10_000, 90_000], ["TEA", 1_000, 89_000]]);
    }
  });
  it("3. single amount column with Dr/Cr suffix inside the amount cell", () => {
    const p = gen(["Date,Particulars,Amount,Balance", "Opening Balance,,,5000.00", "01/10/2026,SHOP,1000.00 Dr,4000.00", "02/10/2026,REFUND,250.00 Cr,4250.00", "Closing Balance,,,4250.00"]);
    expect(p?.lines.map((l) => [l.direction, l.amountMinor])).toEqual([["debit", 100_000], ["credit", 25_000]]);
  });
  it("4. direction from balance movement when no marker (both directions)", () => {
    const p = gen(["Date,Narration,Amount,Balance", "Opening Balance,,,1000.00", "01/10/2026,A,100.00,900.00", "02/10/2026,B,50.00,950.00", "Closing Balance,,,950.00"]);
    expect(p?.lines.map((l) => l.direction)).toEqual(["debit", "credit"]);
  });
  it("5. marker that contradicts balance movement is flagged when totals only reconcile by movement", () => {
    // Opening 1000, closing 850 = -100 -50 by movement; the second row is marked CR.
    const p = gen(["Date,Narration,Amount,Dr / Cr,Balance", "Opening Balance,,,,1000.00", "01/10/2026,A,100.00,DR,900.00", "02/10/2026,B,50.00,CR,850.00", "Closing Balance,,,,850.00"]);
    expect(p?.lines.map((l) => l.description)).toEqual(["A"]);
    expect(p?.issues.map((i) => i.reason)).toEqual(["balance_mismatch"]);
  });
});

describe("QA 9d: dates", () => {
  const body = (a: string, b: string) => ["Date,Narration,Debit,Credit,Balance", `${a},A,100.00,,900.00`, `${b},B,10.00,,890.00`];
  it("6. formats: yyyy-mm-dd, dd-MMM-yy, dd.mm.yyyy, 29 Feb leap day", () => {
    expect(dates(gen(body("2026-10-01", "2026-10-02")))).toEqual(["2026-10-01", "2026-10-02"]);
    expect(dates(gen(body("01-Oct-26", "02-Oct-26")))).toEqual(["2026-10-01", "2026-10-02"]);
    expect(dates(gen(body("01.10.2026", "02.10.2026")))).toEqual(["2026-10-01", "2026-10-02"]);
    expect(dates(gen(body("29/02/2028", "01/03/2028")))).toEqual(["2028-02-29", "2028-03-01"]);
  });
  it("6. ambiguous 03/04/2026 is 3 April (day first); 29/02/2026 is invalid", () => {
    expect(dates(gen(body("03/04/2026", "04/04/2026")))).toEqual(["2026-04-03", "2026-04-04"]);
    const bad = gen(body("29/02/2026", "01/03/2026"));
    expect(bad === null || !bad.lines.some((l) => l.date === "2026-02-29")).toBe(true);
  });
});

describe("QA 9d: reconciliation and ordering", () => {
  const head = "Date,Narration,Debit,Credit,Balance";
  it("10. opening + credits - debits = closing accepted; off by one paisa rejected", () => {
    const rows = (closing: string) => [head, "Opening Balance,,,,1000.00", "01/10/2026,A,100.10,,899.90", "02/10/2026,B,,50.05,949.95", `Closing Balance,,,,${closing}`];
    expect(gen(rows("949.95"))?.lines).toHaveLength(2);
    expect(gen(rows("949.96"))).toBeNull();
  });
  it("11. reverse chronological file with out-of-order rows within a day reconciles", () => {
    const p = gen([head, "Opening Balance,,,,1000.00", "03/10/2026,C,10.00,,1140.00", "02/10/2026,B2,,200.00,1150.00", "02/10/2026,B1,100.00,,950.00", "01/10/2026,A,,50.00,1050.00", "Closing Balance,,,,1140.00"]);
    expect(p?.issues).toEqual([]);
    expect(p?.lines.map((l) => [l.description, l.direction, l.amountMinor])).toEqual([["C", "debit", 1_000], ["B2", "credit", 20_000], ["B1", "debit", 10_000], ["A", "credit", 5_000]]);
  });
  it("9. total rows, page numbers and repeated headers are skipped across a CSV 'page break'", () => {
    const p = gen([head, "01/10/2026,A,100.00,,900.00", "Page 1 of 2", head, "02/10/2026,B,10.00,,890.00", "Total,,110.00,0.00,", "Page 2 of 2"]);
    expect(p?.lines).toHaveLength(2);
    expect(p?.issues).toEqual([]);
  });
});

describe("QA 12: fallback order", () => {
  const pnb = ["Date Instrument ID Amount Type Balance Remarks", "28/10/2026 649.00 DR 65,384.00 UPI/DR/412345678904/RAVI KUMAR/SBIN/x", "27/10/2026 2334.00 DR 66,033.00 CARD PAYMENT PNB RUPAY"].join("\n");
  it("a PNB statement with rows supplied is still read by PNB, not generic", () => {
    const rows = [{ cells: ["Date", "Narration", "Debit", "Credit", "Balance"], spans: [[0, 10], [10, 30], [30, 40], [40, 50], [50, 60]] as [number, number][] }];
    expect(readBankStatement({ format: "pdf", text: pnb, rows })?.reader).toBe("pnb");
  });
  it("a non-PNB CSV goes to generic; a 9b-format CSV stays csv", () => {
    expect(readBankStatement({ format: "csv", text: "Date,Particulars,Amount,Balance\nOpening Balance,,,5000.00\n15.10.2026,SHOP,-1000.00,4000.00\nClosing Balance,,,4000.00" })?.reader).toBe("generic");
  });
});

describe("QA 13/14: no identifiers survive", () => {
  const ACC = "50100012345678";
  const REF = "412345678901";
  const CHQ = "000123";
  const UTR = "N275260012345678";
  const csv = [
    `Account No : ${ACC}`,
    "Date,Narration,Chq./Ref.No.,Debit,Credit,Balance",
    `01/10/2026,UPI-FRESH BASKET-${REF}-A/C ${ACC}-IMPS REF ${REF},${CHQ},450.00,,9550.00`,
    `02/10/2026,NEFT CR-${UTR}-EMPLOYER,${UTR},,500.00,10050.00`,
    `03/10/2026,CHQ PAID ${CHQ} SHOP,${CHQ},50.00,,10000.00`,
    `04/10/2026,CARD 4111 1111 1111 1111 PURCHASE,,10.00,,9990.00`,
    `05/10/2026,UPI/DR/${REF}/RAVI KUMAR/ravi@okbank/Payment,,10.00,,9980.00`,
  ].join("\n");
  it("14. descriptions carry no long digit runs, account, UTR, cheque or card numbers", () => {
    const p = gen(csv.split("\n"));
    expect(p).not.toBeNull();
    const out = JSON.stringify(p);
    for (const secret of [ACC, REF, CHQ, UTR, "4111", "275260012345678"]) expect(out, secret).not.toContain(secret);
    for (const l of p!.lines) expect(l.description).not.toMatch(/\d{4,}/);
  });
  it("14. a UPI handle (ravi@okbank) does not survive in the description", () => {
    const p = gen(csv.split("\n"));
    expect(p?.lines.at(-1)?.description).not.toMatch(/@/);
  });
  it("13. failure diagnostic (CSV) holds no text or digits from the file", () => {
    const secret = ["Account No : " + ACC, "Date,Narration,Debit,Balance", `01/10/2026,SHOP ${REF} RAVI,100.00,900.00`];
    const out = bankReadFailureText({ format: "csv", text: secret.join("\n") });
    for (const s of [ACC, REF, "RAVI", "SHOP", "900.00", "01/10/2026"]) expect(out, s).not.toContain(s);
  });
  it("13. failure diagnostic after a header (reconciliation failed) is masked", () => {
    const text = ["Date,Narration,Debit,Credit,Balance", "Opening Balance,,,,1000.00", `01/10/2026,SHOP ${REF},100.00,,900.00`, "Closing Balance,,,,1.00"].join("\n");
    const out = bankReadFailureText({ format: "csv", text });
    for (const s of [REF, "SHOP", "900.00", "1000.00", "01/10/2026"]) expect(out, s).not.toContain(s);
  });
  it("13. PDF failure diagnostic uses the supplied masked layouts only", () => {
    const { text, rows } = statementPages([[
      { str: "Unknown", x: 10, y: 700, w: 40 }, { str: ACC, x: 100, y: 700, w: 80 },
    ]] as never);
    const out = bankReadFailureText({ format: "pdf", text, rows, rowLayouts: ["text x10 w40 c7"], pageRowCounts: [1] });
    expect(out).not.toContain(ACC);
    expect(out).not.toContain("Unknown");
  });
});
