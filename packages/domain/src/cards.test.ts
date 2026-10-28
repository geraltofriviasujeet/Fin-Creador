import { describe, expect, it } from "vitest";
import {
  borrowingDueStatus,
  cardBillMinor,
  cardBillState,
  cardCycleDate,
  cardDueDate,
  cardUtilisation,
  emisInCycle,
  latestStatementCycle,
  payBillDefaultMinor,
  statementDifferenceMinor,
  statementReminder,
} from "./cards";
import { LIABILITY_ACCOUNT_KINDS, MONEY_ACCOUNT_KINDS, isLiabilityKind, isMoneyAccountKind, summarizeHoldings } from "./holdings";

describe("cardCycleDate", () => {
  it("clamps 29, 30 and 31 to the month end, February and leap years included", () => {
    expect(cardCycleDate(31, "2026-04-10")).toBe("2026-04-30");
    expect(cardCycleDate(30, "2027-02-01")).toBe("2027-02-28");
    expect(cardCycleDate(29, "2028-02-15")).toBe("2028-02-29");
    expect(cardCycleDate(31, "2028-02-15")).toBe("2028-02-29");
    expect(cardCycleDate(15, "2026-12-31", 1)).toBe("2027-01-15");
    expect(cardCycleDate(15, "2027-01-02", -1)).toBe("2026-12-15");
  });

  it("refuses a day outside 1 to 31", () => {
    expect(() => cardCycleDate(0, "2026-01-01")).toThrow(RangeError);
    expect(() => cardCycleDate(32, "2026-01-01")).toThrow(RangeError);
  });
});

describe("cardDueDate", () => {
  it("is the first due-day date after the statement", () => {
    expect(cardDueDate("2026-10-05", 25)).toBe("2026-10-25");
    expect(cardDueDate("2026-10-20", 8)).toBe("2026-11-08");
    expect(cardDueDate("2026-10-20", 20)).toBe("2026-11-20");
    // A statement entered after the card's due day of that month.
    expect(cardDueDate("2026-10-28", 25)).toBe("2026-11-25");
  });

  it("clamps the due day in the due month", () => {
    expect(cardDueDate("2027-01-31", 30)).toBe("2027-02-28");
    expect(cardDueDate("2028-01-31", 30)).toBe("2028-02-29");
    expect(cardDueDate("2026-02-28", 30)).toBe("2026-03-30");
    // Statement day 29 clamped to 28 February; a due day of 30 is not that same day.
    expect(cardDueDate("2027-02-28", 30)).toBe("2027-03-30");
  });
});

describe("latestStatementCycle and statementReminder", () => {
  const card = { statementDay: 20, trackingStartedOn: "2026-01-01", archived: false };

  it("starts the day after the statement day", () => {
    expect(latestStatementCycle(20, "2026-10-20").statementDate).toBe("2026-09-20");
    expect(latestStatementCycle(20, "2026-10-21")).toEqual({ statementDate: "2026-10-20", previousDate: "2026-09-20" });
    expect(statementReminder(card, [], "2026-10-20")?.statementDate).toBe("2026-09-20");
    expect(statementReminder(card, [], "2026-10-21")?.statementDate).toBe("2026-10-20");
  });

  it("stops once a statement after the previous cycle is entered", () => {
    expect(statementReminder(card, ["2026-09-20"], "2026-10-21")).not.toBeNull();
    expect(statementReminder(card, ["2026-10-19"], "2026-10-21")).toBeNull();
    expect(statementReminder(card, ["2026-10-20"], "2026-10-21")).toBeNull();
  });

  it("is quiet for an archived card and for a cycle before the card was added", () => {
    expect(statementReminder({ ...card, archived: true }, [], "2026-10-21")).toBeNull();
    expect(statementReminder({ ...card, trackingStartedOn: "2026-10-21" }, [], "2026-10-21")).toBeNull();
  });

  it("handles a 31st statement day in February", () => {
    expect(latestStatementCycle(31, "2027-03-01")).toEqual({ statementDate: "2027-02-28", previousDate: "2027-01-31" });
  });
});

describe("bills", () => {
  it("leaves card EMIs out of the bill", () => {
    expect(cardBillMinor(25_000_00, 5_000_00)).toBe(20_000_00);
    expect(() => cardBillMinor(1_00, 2_00)).toThrow(RangeError);
  });

  it("offers the difference only when the bill is more than what is owed", () => {
    expect(statementDifferenceMinor(20_000_00, 18_500_00)).toBe(1_500_00);
    expect(statementDifferenceMinor(20_000_00, 21_000_00)).toBe(0);
    expect(statementDifferenceMinor(20_000_00, -1_000_00)).toBe(21_000_00); // a credit balance
    expect(statementDifferenceMinor(20_000_00, null)).toBe(0); // before the card was added
  });

  it("shows paid, minimum paid and part-paid, and stops reminders once the minimum is covered", () => {
    const bill = { amountDueMinor: 10_000_00, minimumDueMinor: 500_00, closed: false };
    expect(cardBillState({ ...bill, paidMinor: 0 })).toEqual({ state: "unpaid", leftMinor: 10_000_00, covered: false });
    expect(cardBillState({ ...bill, paidMinor: 200_00 })).toEqual({ state: "part_paid", leftMinor: 9_800_00, covered: false });
    expect(cardBillState({ ...bill, paidMinor: 500_00 })).toEqual({ state: "minimum_paid", leftMinor: 9_500_00, covered: true });
    expect(cardBillState({ ...bill, paidMinor: 10_000_00 })).toEqual({ state: "paid", leftMinor: 0, covered: true });
    expect(cardBillState({ ...bill, paidMinor: 12_000_00 }).leftMinor).toBe(0);
    expect(cardBillState({ ...bill, minimumDueMinor: null, paidMinor: 200_00, closed: true })).toEqual({ state: "part_paid", leftMinor: 9_800_00, covered: true });
  });

  it("defaults Pay bill to the bill minus what is paid, at most what is owed", () => {
    expect(payBillDefaultMinor(10_000_00, 2_000_00, 50_000_00)).toBe(8_000_00);
    expect(payBillDefaultMinor(10_000_00, 2_000_00, 3_000_00)).toBe(3_000_00);
    expect(payBillDefaultMinor(10_000_00, 12_000_00, 3_000_00)).toBe(0);
  });
});

describe("cardUtilisation", () => {
  it("warns at 80% and 100% of the limit", () => {
    expect(cardUtilisation(79_999, 100_000)).toEqual({ bps: 7_999, level: "ok" });
    expect(cardUtilisation(80_000, 100_000)).toEqual({ bps: 8_000, level: "high" });
    expect(cardUtilisation(100_000, 100_000)).toEqual({ bps: 10_000, level: "over" });
    expect(cardUtilisation(-5_000, 100_000)).toEqual({ bps: 0, level: "ok" });
  });
});

describe("borrowingDueStatus", () => {
  it("is paid only when nothing is owed", () => {
    expect(borrowingDueStatus(1)).toBe("pending");
    expect(borrowingDueStatus(0)).toBe("paid");
    expect(borrowingDueStatus(-100)).toBe("paid");
  });
});

describe("liability kinds", () => {
  it("never overlap the money kinds", () => {
    expect(LIABILITY_ACCOUNT_KINDS).toEqual(["loan", "card", "borrowing"]);
    for (const kind of LIABILITY_ACCOUNT_KINDS) {
      expect(isLiabilityKind(kind)).toBe(true);
      expect(isMoneyAccountKind(kind)).toBe(false);
    }
    for (const kind of MONEY_ACCOUNT_KINDS) expect(isLiabilityKind(kind)).toBe(false);
  });

  it("leaves card and borrowing accounts out of Total available", () => {
    const account = (id: string, kind: string, opening: number) => ({
      id,
      kind: kind as "bank",
      bankType: null,
      currency: "INR",
      openingBalanceMinor: opening,
      openingBalanceDate: "2026-01-01",
      archived: false,
      inflowMinor: 0,
      outflowMinor: 0,
    });
    const summary = summarizeHoldings([account("b", "bank", 1_000), account("c", "card", -5_000), account("d", "borrowing", -7_000)], "INR");
    expect(summary.totalAvailableMinor).toBe(1_000);
    expect(summary.rows.map((r) => r.account.id)).toEqual(["b"]);
  });
});

describe("emisInCycle", () => {
  it("adds card EMIs due after the previous statement date, up to this one", () => {
    const emis = [
      { dueDate: "2026-09-20", amountMinor: 1_000_00 },
      { dueDate: "2026-09-21", amountMinor: 2_000_00 },
      { dueDate: "2026-10-20", amountMinor: 3_000_00 },
      { dueDate: "2026-10-21", amountMinor: 4_000_00 },
    ];
    expect(emisInCycle(emis, "2026-10-20", 20)).toBe(5_000_00);
    expect(emisInCycle([], "2026-10-20", 20)).toBe(0);
  });
});
