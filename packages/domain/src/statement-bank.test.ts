import { describe, expect, it } from "vitest";
import {
  MAX_BANK_STATEMENT_LINES,
  bankLineDecision,
  bankStatementLineKey,
  bankStatementNeedsCheck,
  isBankHeaderRow,
  parsePnbSavingsStatementText,
} from "./statement-bank";

// Invented PNB savings statement text, as the PDF reader gives it (one row per line).
const HEADER = [
  "PUNJAB NATIONAL BANK",
  "Account No 0000111122223333",
  "Customer Name EXAMPLE PERSON",
  "Address 1 EXAMPLE ROAD, KOLKATA 700001",
  "",
  "Date Instrument ID Amount Type Balance Remarks",
];
const BODY = [
  "28/10/2026 649.00 DR 65,384.00 UPI/DR/412345678904/RAVI KUMAR/SBIN/ravi9876543210@okaxis",
  "27/10/2026 2334.00 DR 66,033.00 CARD PAYMENT PNB RUPAY",
  "26/10/2026 1200.00 CR 68,367.00 UPI/CR/412345678903/RAVI KUMAR/SBIN/ravi9876543210@okaxis",
  "25/10/2026 5000.00 DR 67,167.00 IMPS/TRANSFER TO OWN ACCOUNT",
  "24/10/2026 649.00 DR 72,167.00 UPI/DR/412345678902/RAVI KUMAR/SBIN/",
  "ravi9876543210@okaxis",
  "23/10/2026 1784.00 DR 72,816.00 UPI/DR/412345678901/FRESH BASKET/HDFC/freshbasket@okhdfc",
  "22/10/2026 N123456789 50000.00 CR 74,600.00 NEFT/SALARY OCT/EXAMPLE EMPLOYER PVT LTD",
];
const SUMMARY = ["", "Opening Balance 24,600.00", "Closing Balance 65,384.00", "Date: 30/10/2026 Page 1"];
const statement = (body = BODY, summary = SUMMARY) => [...HEADER, ...body, ...summary].join("\n");

describe("parsePnbSavingsStatementText", () => {
  it("reads every line newest first: date, amount, DR / CR, balance, cleaned remarks", () => {
    const parsed = parsePnbSavingsStatementText(statement());
    expect(parsed.issues).toEqual([]);
    expect(parsed.lines.map((l) => [l.date, l.amountMinor, l.direction, l.balanceMinor, l.description])).toEqual([
      ["2026-10-28", 64_900, "debit", 6_538_400, "RAVI KUMAR"],
      ["2026-10-27", 233_400, "debit", 6_603_300, "CARD PAYMENT PNB RUPAY"],
      ["2026-10-26", 120_000, "credit", 6_836_700, "RAVI KUMAR"],
      ["2026-10-25", 500_000, "debit", 6_716_700, "IMPS/TRANSFER TO OWN ACCOUNT"],
      ["2026-10-24", 64_900, "debit", 7_216_700, "RAVI KUMAR"],
      ["2026-10-23", 178_400, "debit", 7_281_600, "FRESH BASKET"],
      ["2026-10-22", 5_000_000, "credit", 7_460_000, "NEFT/SALARY OCT/EXAMPLE EMPLOYER PVT LTD"],
    ]);
    expect(parsed.summary).toEqual({ from: "2026-10-22", to: "2026-10-28", openingMinor: 2_460_000, closingMinor: 6_538_400 });
    expect(parsed.checks.map((c) => [c.name, c.status])).toEqual([["balance_chain", "ok"], ["opening", "ok"], ["closing", "ok"]]);
    expect(bankStatementNeedsCheck(parsed)).toBe(false);
  });

  it("keeps nothing from above the column header, nor the instrument id, UPI reference, bank code or handle", () => {
    const kept = JSON.stringify(parsePnbSavingsStatementText(statement()));
    for (const secret of ["0000111122223333", "EXAMPLE PERSON", "EXAMPLE ROAD", "700001", "N123456789", "412345678", "SBIN", "HDFC", "9876543210", "okaxis", "@"]) {
      expect(kept).not.toContain(secret);
    }
  });

  it("a broken balance chain or a printed opening / closing that disagrees means Check this statement", () => {
    const broken = BODY.map((row) => row.replace("67,167.00", "67,168.00"));
    const chain = parsePnbSavingsStatementText(statement(broken));
    expect(chain.checks[0]).toMatchObject({ name: "balance_chain", status: "mismatch", lines: [2, 3] });
    expect(bankStatementNeedsCheck(chain)).toBe(true);
    const closing = parsePnbSavingsStatementText(statement(BODY, ["Opening Balance 24,600.00", "Closing Balance 65,000.00"]));
    expect(closing.checks.map((c) => c.status)).toEqual(["ok", "ok", "mismatch"]);
  });

  it("without a printed opening and closing, those two checks are unchecked, not failed", () => {
    const parsed = parsePnbSavingsStatementText(statement(BODY, []));
    expect(parsed.checks.map((c) => [c.name, c.status])).toEqual([["balance_chain", "ok"], ["opening", "unchecked"], ["closing", "unchecked"]]);
    expect(bankStatementNeedsCheck(parsed)).toBe(false);
  });

  it("lists rows it can't read by line and masked shape, and reads nothing without a column header", () => {
    const parsed = parsePnbSavingsStatementText(statement([...BODY.slice(0, 2), "26/10/2026 TWELVE HUNDRED CR 68,367.00 GIFT", ...BODY.slice(2)]));
    expect(parsed.issues).toEqual([{ line: 9, reason: "no_amount", shape: "date, text, amount, text" }]);
    expect(parsePnbSavingsStatementText(BODY.join("\n")).lines).toEqual([]);
  });

  it("caps the lines read", () => {
    const rows = Array.from({ length: MAX_BANK_STATEMENT_LINES + 2 }, () => "01/10/2026 1.00 DR 100.00 FEE");
    const parsed = parsePnbSavingsStatementText(statement(rows, []));
    expect(parsed.lines).toHaveLength(MAX_BANK_STATEMENT_LINES);
    expect(parsed.issues.map((i) => i.reason)).toEqual(["too_many_lines", "too_many_lines"]);
  });

  it("recognises the column header row", () => {
    expect(isBankHeaderRow("Date Instrument ID Amount Type Balance Remarks")).toBe(true);
    expect(isBankHeaderRow("Txn Date Narration Amount Dr/Cr Balance")).toBe(true);
    expect(isBankHeaderRow("Date Amount Balance")).toBe(false);
  });
});

describe("bank line decisions and keys", () => {
  const [line] = parsePnbSavingsStatementText(statement()).lines;
  it("skips lines before the account was added and in the future", () => {
    expect(bankLineDecision({ date: "2026-10-01" }, { accountAddedOn: "2026-10-02", today: "2026-10-30" })).toEqual({ importable: false, reason: "before_account" });
    expect(bankLineDecision({ date: "2026-10-31" }, { accountAddedOn: "2026-10-02", today: "2026-10-30" })).toEqual({ importable: false, reason: "future" });
    expect(bankLineDecision({ date: "2026-10-02" }, { accountAddedOn: "2026-10-02", today: "2026-10-30" })).toEqual({ importable: true });
  });

  it("the key depends on the account and every parsed value, the balance included", () => {
    const key = bankStatementLineKey("acct-1", line!);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(bankStatementLineKey("acct-1", line!)).toBe(key);
    expect(bankStatementLineKey("acct-2", line!)).not.toBe(key);
    expect(bankStatementLineKey("acct-1", { ...line!, balanceMinor: line!.balanceMinor + 1 })).not.toBe(key);
  });
});
