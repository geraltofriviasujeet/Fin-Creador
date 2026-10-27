import { describe, expect, it } from "vitest";
import { emi } from "./goals";
import {
  beforeTrackingDate,
  checkPaymentSplit,
  defaultPaymentSplit,
  instalmentDate,
  loanEmiEstimate,
  loanProgress,
  loanSchedule,
  minimumEmiMinor,
  monthlyInterestMinor,
  moratoriumDates,
  outstandingFromBalance,
  scheduleTotals,
  simpleInterestMinor,
} from "./loans";

const LAKH = 1_00_000_00; // ₹1,00,000 in paise

describe("monthlyInterestMinor and simpleInterestMinor", () => {
  it("takes a twelfth of the yearly rate, rounded once", () => {
    expect(monthlyInterestMinor(10 * LAKH, 850)).toBe(708_333); // 7,083.333… → 7,083.33
    expect(monthlyInterestMinor(3, 2_000)).toBe(0); // 0.005 → 0
    expect(monthlyInterestMinor(6, 10_000)).toBe(1); // 0.5 → 1 (half away from zero)
    expect(monthlyInterestMinor(10 * LAKH, 0)).toBe(0);
  });

  it("does not compound over the moratorium", () => {
    expect(simpleInterestMinor(5 * LAKH, 1_000, 12)).toBe(50_000_00); // 10% of ₹5L for a year
    expect(simpleInterestMinor(5 * LAKH, 950, 7)).toBe(2_770_833); // 27,708.333… → 27,708.33
    expect(simpleInterestMinor(5 * LAKH, 1_000, 0)).toBe(0);
  });
});

describe("loanEmiEstimate", () => {
  it("ongoing: the EMI on what is owed over the EMIs left", () => {
    const est = loanEmiEstimate({ startMode: "ongoing", outstandingMinor: 25 * LAKH, rateBps: 875, remainingMonths: 180 });
    expect(est.emiMinor).toBe(emi({ principalMinor: 25 * LAKH, annualRateBps: 875, months: 180 }).emiMinor);
    expect(est).toMatchObject({ principalMinor: 25 * LAKH, capitalisedMinor: 0, moratoriumMonthlyInterestMinor: 0, months: 180 });
  });

  it("starts later, capitalised: simple moratorium interest is added before the EMI", () => {
    const est = loanEmiEstimate({
      startMode: "starts_later",
      disbursedMinor: 5 * LAKH,
      rateBps: 1_000,
      tenureMonths: 60,
      moratoriumMonths: 12,
      moratoriumInterest: "capitalise",
    });
    expect(est.capitalisedMinor).toBe(50_000_00);
    expect(est.principalMinor).toBe(5 * LAKH + 50_000_00);
    expect(est.emiMinor).toBe(emi({ principalMinor: 5 * LAKH + 50_000_00, annualRateBps: 1_000, months: 60 }).emiMinor);
    expect(est.moratoriumMonthlyInterestMinor).toBe(0);
  });

  it("starts later, paid monthly: interest-only instalments, EMI on the amount taken", () => {
    const est = loanEmiEstimate({
      startMode: "starts_later",
      disbursedMinor: 5 * LAKH,
      rateBps: 1_000,
      tenureMonths: 60,
      moratoriumMonths: 12,
      moratoriumInterest: "pay_monthly",
    });
    expect(est.capitalisedMinor).toBe(0);
    expect(est.moratoriumMonthlyInterestMinor).toBe(416_667); // 4,166.666… → 4,166.67
    expect(est.emiMinor).toBe(emi({ principalMinor: 5 * LAKH, annualRateBps: 1_000, months: 60 }).emiMinor);
  });

  it("a no-cost EMI is amount / months", () => {
    const est = loanEmiEstimate({ startMode: "ongoing", outstandingMinor: 60_000_00, rateBps: 0, remainingMonths: 6 });
    expect(est.emiMinor).toBe(10_000_00);
  });

  it("needs the moratorium interest rule when there is a moratorium", () => {
    expect(() =>
      loanEmiEstimate({ startMode: "starts_later", disbursedMinor: LAKH, rateBps: 900, tenureMonths: 12, moratoriumMonths: 3, moratoriumInterest: null }),
    ).toThrow(RangeError);
  });
});

describe("instalment dates", () => {
  it("counts months from the first due date, clamped to the month end", () => {
    expect(instalmentDate("2027-01-31", 1)).toBe("2027-01-31");
    expect(instalmentDate("2027-01-31", 2)).toBe("2027-02-28");
    expect(instalmentDate("2027-01-31", 3)).toBe("2027-03-31"); // not 28: always from the first date
    expect(instalmentDate("2027-11-30", 4)).toBe("2028-02-29"); // leap year
  });

  it("puts moratorium interest in the months before the first EMI", () => {
    expect(moratoriumDates("2027-07-31", 3)).toEqual(["2027-04-30", "2027-05-31", "2027-06-30"]);
    expect(moratoriumDates("2027-01-15", 2)).toEqual(["2026-11-15", "2026-12-15"]);
    expect(moratoriumDates("2027-01-15", 0)).toEqual([]);
  });

  it("dates this month's EMI already paid one month before the next one", () => {
    expect(beforeTrackingDate("2026-11-05", true)).toBe("2026-10-05");
    expect(beforeTrackingDate("2026-03-31", true)).toBe("2026-02-28");
    expect(beforeTrackingDate("2026-11-05", false)).toBeNull();
  });
});

describe("loanSchedule", () => {
  it("repays the principal exactly with the estimated EMI", () => {
    const principalMinor = 25 * LAKH;
    const { emiMinor } = emi({ principalMinor, annualRateBps: 875, months: 180 });
    const rows = loanSchedule({ principalMinor, rateBps: 875, emiMinor, months: 180, firstDueDate: "2026-11-05" });
    expect(rows).toHaveLength(180);
    expect(rows.reduce((s, r) => s + r.principalMinor, 0)).toBe(principalMinor);
    expect(rows.at(-1)!.closingMinor).toBe(0);
    // The last instalment absorbs the rounding: within a few rupees of the EMI.
    expect(Math.abs(rows.at(-1)!.amountMinor - emiMinor)).toBeLessThan(180 * 100);
    expect(rows[1]!.dueDate).toBe("2026-12-05");
    for (const r of rows) expect(r.amountMinor).toBe(r.principalMinor + r.interestMinor);
    // Interest is one month on the opening balance of each row.
    expect(rows[0]!.interestMinor).toBe(monthlyInterestMinor(principalMinor, 875));
    expect(rows[1]!.interestMinor).toBe(monthlyInterestMinor(rows[0]!.closingMinor, 875));
  });

  it("no-cost EMI: the last instalment takes the remainder", () => {
    const rows = loanSchedule({ principalMinor: 10_000, rateBps: 0, emiMinor: 3_333, months: 3, firstDueDate: "2026-11-10" });
    expect(rows.map((r) => r.amountMinor)).toEqual([3_333, 3_333, 3_334]);
    expect(rows.every((r) => r.interestMinor === 0)).toBe(true);
  });

  it("follows a higher EMI the person entered: finishes early", () => {
    const rows = loanSchedule({ principalMinor: 100_000, rateBps: 0, emiMinor: 40_000, months: 12, firstDueDate: "2026-11-10" });
    expect(rows.map((r) => r.amountMinor)).toEqual([40_000, 40_000, 20_000]);
    expect(scheduleTotals(rows)).toEqual({ instalments: 3, totalInterestMinor: 0, totalPayableMinor: 100_000, lastDueDate: "2027-01-10" });
  });

  it("follows a lower EMI: the last allowed instalment clears what is left", () => {
    const rows = loanSchedule({ principalMinor: 100_000, rateBps: 0, emiMinor: 10_000, months: 3, firstDueDate: "2026-11-10" });
    expect(rows.map((r) => r.amountMinor)).toEqual([10_000, 10_000, 80_000]);
  });

  it("refuses an EMI that doesn't cover a month's interest", () => {
    const principalMinor = 10 * LAKH;
    const interest = monthlyInterestMinor(principalMinor, 1_200);
    expect(minimumEmiMinor(principalMinor, 1_200)).toBe(interest + 1);
    expect(() => loanSchedule({ principalMinor, rateBps: 1_200, emiMinor: interest, months: 24, firstDueDate: "2026-11-10" })).toThrow(
      /does not cover/,
    );
    expect(loanSchedule({ principalMinor, rateBps: 1_200, emiMinor: interest + 1, months: 24, firstDueDate: "2026-11-10" })).toHaveLength(24);
  });

  it("a single-month loan is one instalment", () => {
    const rows = loanSchedule({ principalMinor: 50_000, rateBps: 1_200, emiMinor: 1, months: 1, firstDueDate: "2026-11-10" });
    expect(rows).toEqual([{ seq: 1, dueDate: "2026-11-10", amountMinor: 50_500, interestMinor: 500, principalMinor: 50_000, closingMinor: 0 }]);
  });
});

describe("defaultPaymentSplit", () => {
  const outstandingMinor = 10 * LAKH;
  const interest = monthlyInterestMinor(outstandingMinor, 850);

  it("EMI: one month's interest, the rest principal", () => {
    expect(defaultPaymentSplit({ kind: "emi", amountDueMinor: 2_000_000, outstandingMinor, rateBps: 850, isLast: false })).toEqual({
      principalMinor: 2_000_000 - interest,
      interestMinor: interest,
      feesMinor: 0,
      totalMinor: 2_000_000,
    });
  });

  it("last EMI, or one that would overpay: clears what is owed", () => {
    const clears = { principalMinor: outstandingMinor, interestMinor: interest, feesMinor: 0, totalMinor: outstandingMinor + interest };
    expect(defaultPaymentSplit({ kind: "emi", amountDueMinor: 2_000_000, outstandingMinor, rateBps: 850, isLast: true })).toEqual(clears);
    expect(defaultPaymentSplit({ kind: "emi", amountDueMinor: 20 * LAKH, outstandingMinor, rateBps: 850, isLast: false })).toEqual(clears);
  });

  it("an instalment below the interest is all interest; interest-only is all interest", () => {
    expect(defaultPaymentSplit({ kind: "emi", amountDueMinor: 100, outstandingMinor, rateBps: 850, isLast: false })).toEqual({
      principalMinor: 0,
      interestMinor: 100,
      feesMinor: 0,
      totalMinor: 100,
    });
    expect(defaultPaymentSplit({ kind: "interest_only", amountDueMinor: 416_667, outstandingMinor, rateBps: 1_000, isLast: false })).toEqual({
      principalMinor: 0,
      interestMinor: 416_667,
      feesMinor: 0,
      totalMinor: 416_667,
    });
  });
});

describe("checkPaymentSplit", () => {
  it("accepts parts that are whole, non-negative and not all zero, principal up to what is owed", () => {
    expect(checkPaymentSplit({ principalMinor: 900, interestMinor: 100, feesMinor: 59_00 }, 1_000)).toBeNull();
    expect(checkPaymentSplit({ principalMinor: 0, interestMinor: 0, feesMinor: 1 }, 0)).toBeNull();
    expect(checkPaymentSplit({ principalMinor: 0, interestMinor: 0, feesMinor: 0 }, 1_000)).toBe("empty");
    expect(checkPaymentSplit({ principalMinor: 1_001, interestMinor: 0, feesMinor: 0 }, 1_000)).toBe("principal_over_outstanding");
    expect(checkPaymentSplit({ principalMinor: -1, interestMinor: 2, feesMinor: 0 }, 1_000)).toBe("invalid");
    expect(checkPaymentSplit({ principalMinor: 1.5, interestMinor: 0, feesMinor: 0 }, 1_000)).toBe("invalid");
  });
});

describe("loanProgress and outstandingFromBalance", () => {
  it("reads what is owed from the liability account and tracks repayment", () => {
    expect(outstandingFromBalance(-25 * LAKH)).toBe(25 * LAKH);
    expect(outstandingFromBalance(0)).toBe(0);
    expect(outstandingFromBalance(500)).toBe(0); // overpaid: nothing owed
    expect(loanProgress(15 * LAKH, 20 * LAKH)).toEqual({ outstandingMinor: 15 * LAKH, repaidMinor: 5 * LAKH, repaidBps: 2_500, closed: false });
    expect(loanProgress(0, 20 * LAKH)).toMatchObject({ repaidBps: 10_000, closed: true });
    // Capitalised interest not yet added: owed can exceed the start figure only by mistake; never negative repaid.
    expect(loanProgress(21 * LAKH, 20 * LAKH)).toMatchObject({ repaidMinor: 0, repaidBps: 0 });
  });
});
