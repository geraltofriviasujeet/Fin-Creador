import { describe, expect, it } from "vitest";
import { hasDigitRun, stripDigitRuns } from "./digits";
import {
  STATEMENT_NOTE_MAX,
  type StatementLine,
  cardLineDecision,
  classifyCardLine,
  cleanStatementDescription,
  numberOccurrences,
  parseStatementAmount,
  parseStatementDate,
  statementLineKeySource,
} from "./statements";

describe("parseStatementDate", () => {
  it.each([
    ["15/10/2026", "2026-10-15"],
    ["05-10-2026", "2026-10-05"],
    ["5.1.2026", "2026-01-05"],
    ["15/10/26", "2026-10-15"],
    ["15 Oct 2026", "2026-10-15"],
    ["15-Oct-26", "2026-10-15"],
    ["15 October, 2026", "2026-10-15"],
    ["15 Sept 2026", "2026-09-15"],
    ["2026-10-15", "2026-10-15"],
    ["29/02/2028", "2028-02-29"],
  ])("%s -> %s (day first)", (text, iso) => expect(parseStatementDate(text)).toBe(iso));

  it.each(["29/02/2026", "31/04/2026", "15/13/2026", "15 Foo 2026", "15 Ma 2026", "2026/10/15", "15/10/2026 x", ""])(
    "rejects %j",
    (text) => expect(parseStatementDate(text)).toBeNull(),
  );
});

describe("parseStatementAmount", () => {
  it.each([
    ["1,28,000.50", 12_800_050, null],
    ["128,000.50", 12_800_050, null],
    ["₹ 450.00", 45_000, null],
    ["Rs. 450", 45_000, null],
    ["INR 450.5", 45_050, null],
    ["450.00 Dr", 45_000, "debit"],
    ["450.00DR", 45_000, "debit"],
    ["1,200.00 Cr", 120_000, "credit"],
    ["1,200.00 cr.", 120_000, "credit"],
    ["-1,200.00", 120_000, "credit"],
    ["₹ -1,200.00", 120_000, "credit"],
  ])("%s", (text, minor, direction) => expect(parseStatementAmount(text)).toEqual({ minor, direction }));

  it.each(["0.00", "12.345", "1,2", "abc", "", "-450.00 Dr", "100000000000.01", "450.00 Rs"])("rejects %j", (text) =>
    expect(parseStatementAmount(text)).toBeNull(),
  );
});

describe("cleanStatementDescription", () => {
  it("strips runs of 4 or more digits, in any script, and masking", () => {
    const { description } = cleanStatementDescription("PAYMENT CARD 5555 XXXX XXXX 0042 REF ٤٥٦٧٨ AT 7 ELEVEN 123");
    expect(description).toBe("PAYMENT CARD REF AT 7 ELEVEN 123");
    expect(hasDigitRun(description, 4)).toBe(false);
  });

  it("drops a foreign amount and keeps its currency", () => {
    expect(cleanStatementDescription("CLOUDHOST INC USD 12.00 SEATTLE")).toEqual({
      description: "CLOUDHOST INC SEATTLE", foreignCurrency: "USD",
    });
    expect(cleanStatementDescription("HOTEL LISBOA 85.50 EUR")).toEqual({ description: "HOTEL LISBOA", foreignCurrency: "EUR" });
  });

  it("does not read UPI or other letter codes as a currency", () => {
    expect(cleanStatementDescription("UPI 123 GROCER")).toEqual({ description: "UPI 123 GROCER", foreignCurrency: null });
  });

  it("caps the note at the stored length, by character", () => {
    const { description } = cleanStatementDescription("₹".repeat(STATEMENT_NOTE_MAX + 20));
    expect(Array.from(description)).toHaveLength(STATEMENT_NOTE_MAX);
  });

  it("stripDigitRuns keeps runs shorter than the minimum", () => {
    expect(stripDigitRuns("A 123 B 1234 C ١٢٣٤٥", 4)).toBe("A 123 B  C ");
  });
});

describe("classifyCardLine", () => {
  it.each([
    ["debit", "FRESH BASKET STORES", "purchase"],
    ["debit", "LATE PAYMENT FEE", "fee"],
    ["debit", "ANNUAL MEMBERSHIP CHARGES", "fee"],
    ["debit", "FUEL SURCHARGE", "fee"],
    ["debit", "FINANCE CHARGES", "interest"],
    ["debit", "INTEREST ON RETAIL BALANCE", "interest"],
    ["debit", "IGST ON LATE PAYMENT FEE", "tax"],
    ["debit", "GST @ 18%", "tax"],
    ["debit", "EMI PRINCIPAL 3 OF 12", "emi"],
    ["debit", "INTEREST ON EMI", "emi"],
    ["credit", "PAYMENT RECEIVED THANK YOU", "payment"],
    ["credit", "NEFT AUTOPAY", "payment"],
    ["credit", "REFUND FRESH BASKET", "refund"],
    ["credit", "SURCHARGE WAIVER", "refund"],
    ["credit", "CONVERTED TO EMI", "emi"],
  ] as const)("%s %s -> %s", (direction, text, kind) => expect(classifyCardLine(direction, text)).toBe(kind));
});

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  date: "2026-10-12", amountMinor: 45_000, direction: "debit", kind: "purchase",
  description: "FRESH BASKET", foreignCurrency: null, occurrence: 0, ...over,
});

describe("numberOccurrences", () => {
  it("numbers identical lines so two equal purchases on one day keep distinct keys", () => {
    const lines = numberOccurrences([line(), line({ amountMinor: 1 }), line(), line({ direction: "credit" })].map(
      ({ occurrence: _, ...rest }) => rest,
    ));
    expect(lines.map((l) => l.occurrence)).toEqual([0, 0, 1, 0]);
  });
});

describe("cardLineDecision", () => {
  const card = { cardAddedOn: "2026-10-01", today: "2026-10-29" };
  it("imports spending dated from the day the card was added to today", () => {
    for (const kind of ["purchase", "fee", "interest", "tax"] as const) {
      expect(cardLineDecision({ kind, date: "2026-10-01" }, card)).toEqual({ importable: true });
    }
    expect(cardLineDecision({ kind: "purchase", date: "2026-10-29" }, card)).toEqual({ importable: true });
  });

  it("skips payments, refunds, EMI lines, lines before the card and future lines, with the reason", () => {
    expect(cardLineDecision({ kind: "payment", date: "2026-10-12" }, card)).toEqual({ importable: false, reason: "payment" });
    expect(cardLineDecision({ kind: "refund", date: "2026-10-12" }, card)).toEqual({ importable: false, reason: "refund" });
    expect(cardLineDecision({ kind: "emi", date: "2026-10-12" }, card)).toEqual({ importable: false, reason: "emi" });
    expect(cardLineDecision({ kind: "purchase", date: "2026-09-30" }, card)).toEqual({ importable: false, reason: "before_card" });
    expect(cardLineDecision({ kind: "purchase", date: "2026-10-30" }, card)).toEqual({ importable: false, reason: "future" });
  });
});

describe("statementLineKeySource", () => {
  const card = "00000000-0000-4000-8000-000000000001";
  it("is stable for the same parsed line and differs when any parsed value differs", () => {
    const base = statementLineKeySource(card, "2026-10-15", line());
    expect(statementLineKeySource(card, "2026-10-15", line())).toBe(base);
    for (const over of [
      { date: "2026-10-13" }, { amountMinor: 45_001 }, { direction: "credit" as const }, { description: "FRESH BASKET 2" }, { occurrence: 1 },
    ]) {
      expect(statementLineKeySource(card, "2026-10-15", line(over))).not.toBe(base);
    }
    expect(statementLineKeySource(card, "2026-11-15", line())).not.toBe(base);
  });

  it("cannot be confused by separators inside the description", () => {
    expect(statementLineKeySource(card, "2026-10-15", line({ description: 'A","B' }))).not.toBe(
      statementLineKeySource(card, "2026-10-15", line({ description: "A", occurrence: 0 })),
    );
  });
});
