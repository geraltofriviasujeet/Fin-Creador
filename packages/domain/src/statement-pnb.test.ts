// Synthetic PNB-style statement text built from the owner's description of the layout only:
// invented person, merchants, amounts and card digits. Never a real statement.
import { describe, expect, it } from "vitest";
import { hasDigitRun } from "./digits";
import { parseCardStatementText, statementNeedsCheck } from "./statement-generic";
import { parseCardStatement, parsePnbCardStatementText } from "./statement-pnb";

// Layout A: rows of labels followed by rows of values; the Network/Last 4 Digit column is present;
// page 2 has no repeated header.
const LAYOUT_A = [
  "PUNJAB NATIONAL BANK CREDIT CARD STATEMENT",
  "EXAMPLE PERSON",
  "12 SAMPLE ROAD, EXAMPLE NAGAR 560001",
  "Card Number 5555 XXXX XXXX 0042",
  "Invoice Date Payment Due Date Total Amount Due Total Amount Due for Month Minimum Amount Due",
  "15-OCT-2026 04-NOV-2026 3,834.00 3,834.00 191.70",
  "Previous Balance Purchases and other charges Cash Advances Payments and Other Credits / Shadow Credits Total Amount Due for Month",
  "1,500.00 4,284.00 0.00 1,950.00 3,834.00",
  "Reward Points Earned 42",
  "Credit Limit 50,000.00 Available Credit Limit 46,166.00",
  "Transaction Date Post Date Network/Last 4 Digit Trnx Details From 16-SEP-2026 to 15-OCT-2026 Amount in Rs",
  "18-SEP-2026 19-SEP-2026 RUPAY - 0042 PAYMENT RECEIVED - THANK YOU 1500.00 Cr",
  "21-SEP-2026 22-SEP-2026 RUPAY - 0042 FRESH BASKET STORES BENGAL 1784.00 Dr",
  "02-OCT-2026 03-OCT-2026 RUPAY - 0042 CLOUDHOST INC USD 12.00 1010.50 Dr",
  "05-OCT-2026 05-OCT-2026 RUPAY - 0042 REFUND FRESH BASKET 450.00 Cr",
  "Date: 15-OCT-2026 Page 1",
  "10-OCT-2026 10-OCT-2026 RUPAY - 0042 LATE PAYMENT FEE 500.00 Dr",
  "10-OCT-2026 10-OCT-2026 RUPAY - 0042 IGST @18% ON LATE PAYMENT FEE 90.00 Dr",
  "12-OCT-2026 12-OCT-2026 RUPAY - 0042 FINANCE CHARGES 899.50 Dr",
  "Total Purchase 2,794.50",
  "Total Taxable Value 500.00",
  "Total GST 90.00",
  "Total Charges Reversed 0.00",
  "Total GST Reversed 0.00",
  "Total Invoice Value 4,284.00",
  "End of Statement",
  "Date: 15-OCT-2026 Page 2",
  "Terms and conditions apply. Call 1800 000 0000.",
].join("\n");

// Layout B: each label with its value on the same row (or the value on the next row), summary boxes
// printed with + - = signs, and no Network/Last 4 Digit column.
const LAYOUT_B = [
  "Invoice Date : 15-OCT-2026",
  "Payment Due Date : 04-NOV-2026",
  "Total Amount Due 3,834.00 Total Amount Due for Month 3,834.00",
  "Minimum Amount Due",
  "191.70",
  "Previous Balance Purchases and other charges Cash Advances Payments and Other Credits / Shadow Credits Total Amount Due for Month",
  "1,500.00 + 4,284.00 + 0.00 - 1,950.00 = 3,834.00",
  "Transaction Date Post Date Trnx Details From 16-SEP-2026 to 15-OCT-2026 Amount in Rs",
  "18-SEP-2026 19-SEP-2026 PAYMENT RECEIVED - THANK YOU 1500.00 Cr",
  "21-SEP-2026 22-SEP-2026 FRESH BASKET STORES BENGAL 1784.00 Dr",
  "02-OCT-2026 03-OCT-2026 CLOUDHOST INC USD 12.00 1010.50 Dr",
  "05-OCT-2026 05-OCT-2026 REFUND FRESH BASKET 450.00 Cr",
  "10-OCT-2026 10-OCT-2026 LATE PAYMENT FEE 500.00 Dr",
  "10-OCT-2026 10-OCT-2026 IGST @18% ON LATE PAYMENT FEE 90.00 Dr",
  "12-OCT-2026 12-OCT-2026 FINANCE CHARGES 899.50 Dr",
  "Total Invoice Value 4,284.00",
  "End of Statement",
].join("\n");

const EXPECTED_LINES = [
  ["2026-09-18", 150_000, "credit", "payment", "PAYMENT RECEIVED - THANK YOU"],
  ["2026-09-21", 178_400, "debit", "purchase", "FRESH BASKET STORES BENGAL"],
  ["2026-10-02", 101_050, "debit", "purchase", "CLOUDHOST INC"],
  ["2026-10-05", 45_000, "credit", "refund", "REFUND FRESH BASKET"],
  ["2026-10-10", 50_000, "debit", "fee", "LATE PAYMENT FEE"],
  ["2026-10-10", 9_000, "debit", "tax", "IGST @18% ON LATE PAYMENT FEE"],
  ["2026-10-12", 89_950, "debit", "interest", "FINANCE CHARGES"],
];

describe.each([
  ["labels above values, Network/Last 4 Digit column", LAYOUT_A],
  ["labels beside values, no network column", LAYOUT_B],
])("parsePnbCardStatementText: %s", (_, text) => {
  const parsed = parsePnbCardStatementText(text);

  it("prefills Enter statement from the top block (Invoice Date, Total Amount Due, Payment Due Date, Minimum Amount Due)", () => {
    expect(parsed.summary).toEqual({ statementDate: "2026-10-15", dueDate: "2026-11-04", totalMinor: 383_400, minimumMinor: 19_170 });
    expect(parsed.period).toEqual({ from: "2026-09-16", to: "2026-10-15" });
  });

  it("reads each line by its Transaction Date, with Dr / Cr, and keeps the description as printed", () => {
    expect(parsed.lines.map((l) => [l.date, l.amountMinor, l.direction, l.kind, l.description])).toEqual(EXPECTED_LINES);
    expect(parsed.lines.find((l) => l.foreignCurrency)?.foreignCurrency).toBe("USD");
    expect(parsed.issues).toEqual([]);
  });

  it("passes both self-checks", () => {
    expect(parsed.checks).toEqual([{ name: "summary", status: "ok" }, { name: "invoice_total", status: "ok" }]);
    expect(statementNeedsCheck(parsed)).toBe(false);
  });

  it("keeps no card digits, name or address", () => {
    const out = JSON.stringify(parsed);
    expect(out).not.toMatch(/0042|5555|RUPAY|EXAMPLE PERSON|SAMPLE ROAD|560001/);
    for (const l of parsed.lines) expect(hasDigitRun(l.description, 4)).toBe(false);
  });
});

describe("parsePnbCardStatementText self-checks", () => {
  it("flags a summary that does not add up", () => {
    const parsed = parsePnbCardStatementText(LAYOUT_B.replace("1,500.00 + 4,284.00", "1,600.00 + 4,284.00"));
    expect(parsed.checks).toContainEqual({ name: "summary", status: "mismatch" });
    expect(statementNeedsCheck(parsed)).toBe(true);
  });

  it("flags Dr lines that do not sum to Total Invoice Value (a line the parser could not read)", () => {
    const parsed = parsePnbCardStatementText(LAYOUT_B.replace("FINANCE CHARGES 899.50 Dr", "FINANCE CHARGES"));
    expect(parsed.issues).toEqual([{ line: 15, reason: "no_amount" }]);
    expect(parsed.checks).toContainEqual({ name: "invoice_total", status: "mismatch" });
    expect(statementNeedsCheck(parsed)).toBe(true);
  });

  it("leaves a check unchecked when a figure is missing", () => {
    const parsed = parsePnbCardStatementText(LAYOUT_B.replace("Total Invoice Value 4,284.00\n", ""));
    expect(parsed.checks).toContainEqual({ name: "invoice_total", status: "unchecked" });
    expect(statementNeedsCheck(parsed)).toBe(false);
  });

  it("gives a credit balance as a bill of 0 and still checks it", () => {
    const parsed = parsePnbCardStatementText([
      "Invoice Date 15-OCT-2026 Payment Due Date 04-NOV-2026",
      "Total Amount Due 300.00 Cr Minimum Amount Due 0.00",
      "Previous Balance Purchases and other charges Cash Advances Payments and Other Credits / Shadow Credits",
      "0.00 200.00 0.00 500.00",
      "21-SEP-2026 22-SEP-2026 SHOP 200.00 Dr",
      "Total Invoice Value 200.00",
    ].join("\n"));
    expect(parsed.summary).toMatchObject({ totalMinor: 0, minimumMinor: 0 });
    expect(parsed.checks).toEqual([{ name: "summary", status: "ok" }, { name: "invoice_total", status: "ok" }]);
  });

  it("ignores rows after End of Statement", () => {
    const parsed = parsePnbCardStatementText(`${LAYOUT_B}\n20-OCT-2026 20-OCT-2026 AFTER THE END 10.00 Dr`);
    expect(parsed.lines).toHaveLength(EXPECTED_LINES.length);
  });
});

describe("parseCardStatement", () => {
  it("uses the PNB parser for Punjab National Bank cards and the generic one otherwise", () => {
    expect(parseCardStatement(LAYOUT_A, "Punjab National Bank")).toEqual(parsePnbCardStatementText(LAYOUT_A));
    expect(parseCardStatement(LAYOUT_A, "HDFC Bank")).toEqual(parseCardStatementText(LAYOUT_A));
  });
});
