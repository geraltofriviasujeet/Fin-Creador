import { describe, expect, it } from "vitest";
import { hasDigitRun } from "./digits";
import { parseCardStatementText, statementVerifiesItself } from "./statement-generic";
import { MAX_STATEMENT_LINES, MAX_STATEMENT_TEXT_CHARS } from "./statements";

// Synthetic statement text: invented merchants, amounts and a made-up card number. Never a real statement.
const STATEMENT = [
  "EXAMPLE BANK CREDIT CARD STATEMENT",
  "Card Number 5555 0000 1111 2222",
  "Statement Date: 15/10/2026     Payment Due Date: 04/11/2026",
  "Total Amount Due (₹) 7,935.40   Minimum Amount Due ₹ 400.00",
  "Date Description Amount",
  "16/09/2026 Opening balance 1,500.00",
  "18/09/2026 PAYMENT RECEIVED THANK YOU 1,500.00 Cr",
  "21/09/2026 FRESH BASKET STORES BENGALURU 2,450.75 12",
  "21/09/2026 FRESH BASKET STORES BENGALURU 2,450.75",
  "02 Oct 2026 03 Oct 2026 CLOUDHOST INC USD 12.00 1,010.50 Dr",
  "05/10/2026 REFUND FRESH BASKET STORES 450.00 Cr",
  "07/10/2026 CONVERTED TO EMI PHONE MART 30,000.00 Cr",
  "07/10/2026 EMI PRINCIPAL 1 OF 6 PHONE MART 5,000.00",
  "10/10/2026 LATE PAYMENT FEE 500.00",
  "10/10/2026 IGST ON LATE PAYMENT FEE 90.00",
  "12/10/2026 FINANCE CHARGES 433.40",
  "13/10/2026 PAYMENT CARD 5555 XXXX XXXX 2222 - 1,000.00",
  "31/02/2026 BAD DATE LINE 10.00",
  "14/10/2026 NO AMOUNT HERE",
  "14/10/2026 1234 10.00",
  "Closing balance 7,935.40",
].join("\n");

describe("parseCardStatementText (generic)", () => {
  const parsed = parseCardStatementText(STATEMENT);

  it("reads the summary that prefills Enter statement", () => {
    expect(parsed.summary).toEqual({
      statementDate: "2026-10-15", dueDate: "2026-11-04", totalMinor: 793_540, minimumMinor: 40_000,
    });
  });

  it("reads date, amount and Dr / Cr per line and classifies it", () => {
    expect(parsed.lines.map((l) => [l.date, l.amountMinor, l.direction, l.kind])).toEqual([
      ["2026-09-18", 150_000, "credit", "payment"],
      ["2026-09-21", 245_075, "debit", "purchase"],
      ["2026-09-21", 245_075, "debit", "purchase"],
      ["2026-10-02", 101_050, "debit", "purchase"],
      ["2026-10-05", 45_000, "credit", "refund"],
      ["2026-10-07", 3_000_000, "credit", "emi"],
      ["2026-10-07", 500_000, "debit", "emi"],
      ["2026-10-10", 50_000, "debit", "fee"],
      ["2026-10-10", 9_000, "debit", "tax"],
      ["2026-10-12", 43_340, "debit", "interest"],
      ["2026-10-13", 100_000, "debit", "purchase"],
    ]);
  });

  it("numbers identical lines and ignores trailing reward points", () => {
    const basket = parsed.lines.filter((l) => l.description === "FRESH BASKET STORES BENGALURU");
    expect(basket.map((l) => l.occurrence)).toEqual([0, 1]);
  });

  it("uses the INR amount of a foreign-currency line and drops the foreign amount from the note", () => {
    const foreign = parsed.lines.find((l) => l.foreignCurrency !== null);
    expect(foreign).toMatchObject({ description: "CLOUDHOST INC", foreignCurrency: "USD", amountMinor: 101_050 });
  });

  it("a dash separator before an amount is not a credit; card digits never reach a description", () => {
    const card = parsed.lines.find((l) => l.date === "2026-10-13");
    expect(card).toMatchObject({ direction: "debit", description: "PAYMENT CARD -" });
    for (const l of parsed.lines) expect(hasDigitRun(l.description, 4)).toBe(false);
  });

  it("reports unreadable lines by number and masked shape only, and skips balance lines", () => {
    expect(parsed.issues).toEqual([
      { line: 18, reason: "bad_date", shape: "number, text, amount" },
      { line: 19, reason: "no_amount", shape: "date, text, no amount" },
      { line: 20, reason: "no_description", shape: "date, number, amount" },
    ]);
    expect(JSON.stringify(parsed)).not.toMatch(/Opening|Closing|5555|2222/);
  });

  it("gives a credit balance as a total of 0", () => {
    const { summary } = parseCardStatementText("Total Amount Due 250.00 Cr\nMinimum Amount Due 0.00");
    expect(summary).toMatchObject({ totalMinor: 0, minimumMinor: null });
  });

  it("refuses text above the cap and stops at the line cap", () => {
    expect(parseCardStatementText("x".repeat(MAX_STATEMENT_TEXT_CHARS + 1)).issues).toEqual([{ line: 0, reason: "too_long" }]);
    const many = Array.from({ length: MAX_STATEMENT_LINES + 2 }, () => "01/10/2026 SHOP 1.00").join("\n");
    const capped = parseCardStatementText(many);
    expect(capped.lines).toHaveLength(MAX_STATEMENT_LINES);
    expect(capped.issues).toEqual([{ line: MAX_STATEMENT_LINES + 1, reason: "too_many_lines", shape: "date, text, amount" }]);
  });
});

describe("parseCardStatementText: self-checks and statementVerifiesItself", () => {
  const text = (total = "2,334.00") => [
    "Statement Date 15/10/2026",
    `Total Amount Due ${total}`,
    "Previous Balance 1,500.00",
    "Purchases & Other Charges 2,334.00",
    "Payments & Credits 1,500.00 Cr",
    "Payment Due Date 04/11/2026",
    "18/09/2026 PAYMENT RECEIVED 1,500.00 Cr",
    "21/09/2026 FRESH BASKET 1,784.00",
    "10/10/2026 LATE PAYMENT FEE 550.00",
  ].join("\n");

  it("checks the summary and the debit lines, and verifies a statement whose checks pass", () => {
    const parsed = parseCardStatementText(text());
    expect(parsed.checks.map((c) => [c.name, c.status])).toEqual([["summary", "ok"], ["purchases", "ok"]]);
    expect(statementVerifiesItself(parsed)).toBe(true);
  });

  it("does not verify a statement whose summary doesn't add up, or that prints no summary", () => {
    expect(statementVerifiesItself(parseCardStatementText(text("2,434.00")))).toBe(false);
    const bare = parseCardStatementText("Total Amount Due 2,334.00\n21/09/2026 FRESH BASKET 1,784.00");
    expect(bare.checks).toEqual([]);
    expect(statementVerifiesItself(bare)).toBe(false);
  });
});
