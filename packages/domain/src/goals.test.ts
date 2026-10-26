import { describe, expect, it } from "vitest";
import {
  budgetStatus,
  budgetsForMonth,
  divRoundHalfAway,
  emi,
  goalFigures,
  monthsToTarget,
  percentOfMinor,
  savingPlan,
  type BudgetRow,
  type VehicleDetails,
  type HouseDetails,
  type ItemDetails,
  type TripDetails,
} from "./goals";
import { localDateInTimeZone } from "./dates";

describe("divRoundHalfAway", () => {
  it("rounds halves away from zero", () => {
    expect(divRoundHalfAway(5n, 2n)).toBe(3n);
    expect(divRoundHalfAway(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfAway(4n, 3n)).toBe(1n);
    expect(divRoundHalfAway(5n, 3n)).toBe(2n);
  });
});

describe("percentOfMinor", () => {
  it("takes a share in basis points, rounded once", () => {
    expect(percentOfMinor(1_000_000_00, 2_000)).toBe(200_000_00); // 20% of ₹10,00,000
    expect(percentOfMinor(333, 5_000)).toBe(167); // 166.5 → 167
    expect(percentOfMinor(0, 2_000)).toBe(0);
  });
});

// Expected values computed independently with Python's decimal module (80 digits):
// EMI = P·r·(1+r)^n / ((1+r)^n − 1), r = rate / 12; interest = EMI·n − P; each rounded
// half up once at the end.
describe("emi", () => {
  const cases: [number, number, number, number, number][] = [
    // principal, bps, months, emi, total interest
    [100_000_000, 850, 240, 867_823, 108_277_576], // ₹10 lakh, 8.5%, 20 years → ₹8,678.23
    [500_000_000, 875, 360, 3_933_502, 916_060_730],
    [80_000_000, 950, 60, 1_680_149, 20_808_934],
    [12_000_000, 1_400, 12, 1_077_445, 929_345],
    [1_000_000, 1_599, 9, 118_645, 67_801],
    [250_000, 1_200, 6, 43_137, 8_823],
    [1, 100, 1, 1, 0],
    [10_000_000_000_000, 10_000, 480, 833_333_333_333, 390_000_000_000_000],
  ];
  it.each(cases)("P=%i at %i bp for %i months", (principalMinor, annualRateBps, months, emiMinor, interest) => {
    expect(emi({ principalMinor, annualRateBps, months })).toEqual({
      emiMinor,
      totalInterestMinor: interest,
      totalPayableMinor: principalMinor + interest,
    });
  });

  it("charges no interest at 0% (no-cost EMI)", () => {
    expect(emi({ principalMinor: 100_000, annualRateBps: 0, months: 3 })).toEqual({
      emiMinor: 33_333,
      totalInterestMinor: 0,
      totalPayableMinor: 100_000,
    });
  });

  it("handles the edges exactly: rate 0, tenure 1, the 10^13 maximum", () => {
    // Tenure 1: one instalment of principal plus one month's interest.
    expect(emi({ principalMinor: 100_000_00, annualRateBps: 1_200, months: 1 })).toEqual({ emiMinor: 101_000_00, totalInterestMinor: 1_000_00, totalPayableMinor: 101_000_00 });
    expect(emi({ principalMinor: 100_000_00, annualRateBps: 0, months: 1 })).toEqual({ emiMinor: 100_000_00, totalInterestMinor: 0, totalPayableMinor: 100_000_00 });
    const max = 10_000_000_000_000;
    expect(emi({ principalMinor: max, annualRateBps: 0, months: 480 })).toEqual({ emiMinor: 20_833_333_333, totalInterestMinor: 0, totalPayableMinor: max });
    expect(emi({ principalMinor: max, annualRateBps: 10_000, months: 1 })).toEqual({
      emiMinor: 10_833_333_333_333,
      totalInterestMinor: 833_333_333_333,
      totalPayableMinor: 10_833_333_333_333,
    });
  });

  it("returns safe integers only (no floating point anywhere)", () => {
    for (const [p, bps, n] of [[123_457, 1_234, 37], [99_999_99, 1, 480], [1, 9_999, 7]]) {
      const r = emi({ principalMinor: p!, annualRateBps: bps!, months: n! });
      expect(Object.values(r).every(Number.isSafeInteger)).toBe(true);
    }
  });

  it("rejects out-of-range input", () => {
    expect(() => emi({ principalMinor: 100, annualRateBps: 100, months: 0 })).toThrow(RangeError);
    expect(() => emi({ principalMinor: 100, annualRateBps: 100, months: 481 })).toThrow(RangeError);
    expect(() => emi({ principalMinor: 100, annualRateBps: 10_001, months: 12 })).toThrow(RangeError);
    expect(() => emi({ principalMinor: -1, annualRateBps: 100, months: 12 })).toThrow(RangeError);
    expect(() => emi({ principalMinor: 1.5, annualRateBps: 100, months: 12 })).toThrow(RangeError);
  });
});

describe("monthsToTarget", () => {
  it("counts this month and the target month", () => {
    expect(monthsToTarget("2026-10-26", "2026-10-31")).toBe(1);
    expect(monthsToTarget("2026-10-26", "2026-11-01")).toBe(2);
    expect(monthsToTarget("2026-10-26", "2027-03-15")).toBe(6);
    expect(monthsToTarget("2026-12-31", "2027-01-01")).toBe(2); // year boundary
    expect(monthsToTarget("2028-02-29", "2028-03-01")).toBe(2); // leap day
    expect(monthsToTarget("2026-10-26", "2026-09-30")).toBe(0);
  });
});

describe("savingPlan", () => {
  const today = "2026-10-26";
  it("spreads what is left over the months to the target date", () => {
    expect(savingPlan({ targetMinor: 120_000_00, savedMinor: 30_000_00, targetDate: "2027-03-15", today })).toEqual({
      remainingMinor: 90_000_00,
      months: 6,
      monthlyMinor: 15_000_00,
      basis: "target_date",
      progressBps: 2_500,
    });
  });

  it("rounds the monthly amount once, half away from zero", () => {
    // 100 / 3 = 33.33… → 33; 200 / 3 = 66.66… → 67
    expect(savingPlan({ targetMinor: 100, savedMinor: 0, targetDate: "2026-12-01", today }).monthlyMinor).toBe(33);
    expect(savingPlan({ targetMinor: 200, savedMinor: 0, targetDate: "2026-12-01", today }).monthlyMinor).toBe(67);
  });

  it("a target date in the current month spreads over 1 month", () => {
    expect(savingPlan({ targetMinor: 9_000_00, savedMinor: 1_000_00, targetDate: "2026-10-31", today })).toMatchObject({
      months: 1,
      monthlyMinor: 8_000_00,
      basis: "target_date",
    });
  });

  it("month ends follow the person's time zone (Asia/Kolkata, UTC+5:30)", () => {
    const before = localDateInTimeZone(new Date("2026-10-31T18:29:59Z"), "Asia/Kolkata"); // 23:59:59 IST
    const after = localDateInTimeZone(new Date("2026-10-31T18:30:00Z"), "Asia/Kolkata"); // 00:00 IST, 1 November
    expect([before, after]).toEqual(["2026-10-31", "2026-11-01"]);
    const plan = (day: string) => savingPlan({ targetMinor: 2_000_00, savedMinor: 0, targetDate: "2026-11-20", today: day });
    expect(plan(before)).toMatchObject({ months: 2, monthlyMinor: 1_000_00 });
    expect(plan(after)).toMatchObject({ months: 1, monthlyMinor: 2_000_00 });
    const newYear = localDateInTimeZone(new Date("2026-12-31T18:30:00Z"), "Asia/Kolkata");
    expect(newYear).toBe("2027-01-01");
    expect(savingPlan({ targetMinor: 100, savedMinor: 0, targetDate: "2026-12-31", today: newYear }).basis).toBe("past_due");
  });

  it("assumes 12 months without a target date", () => {
    const plan = savingPlan({ targetMinor: 12_000_00, savedMinor: 0, targetDate: null, today });
    expect(plan).toMatchObject({ months: 12, monthlyMinor: 1_000_00, basis: "assumed_months" });
  });

  it("asks for everything left when the target month has passed", () => {
    const plan = savingPlan({ targetMinor: 5_000_00, savedMinor: 1_000_00, targetDate: "2026-09-30", today });
    expect(plan).toMatchObject({ months: 1, monthlyMinor: 4_000_00, basis: "past_due" });
  });

  it("is reached when saved meets or passes the target", () => {
    expect(savingPlan({ targetMinor: 100, savedMinor: 150, targetDate: null, today })).toEqual({
      remainingMinor: 0,
      months: 0,
      monthlyMinor: 0,
      basis: "reached",
      progressBps: 15_000,
    });
    expect(savingPlan({ targetMinor: 0, savedMinor: 0, targetDate: null, today }).progressBps).toBeNull();
  });
});

describe("goalFigures", () => {
  const trip: TripDetails = {
    v: 1,
    scope: "international",
    place: "Japan",
    people: 2,
    days: 8,
    travelMode: "flight",
    stay: "hotel",
    costs: { transport: 90_000_00, stay: 64_000_00, food: 24_000_00, activities: 15_000_00, visaInsurance: 8_000_00, shopping: 0, buffer: 10_000_00 },
  };

  it("adds up a trip's cost lines", () => {
    expect(goalFigures({ type: "trip", details: trip })).toEqual({ upfrontMinor: 211_000_00, costTotalMinor: 211_000_00, loan: null });
  });

  const car: VehicleDetails = {
    v: 1,
    vehicle: "car",
    condition: "new",
    make: "Maruti Suzuki",
    model: "Swift",
    payment: "cash",
    priceMinor: 8_00_000_00,
    extrasMinor: 60_000_00,
    downPaymentMinor: null,
    loanRateBps: null,
    loanMonths: null,
  };

  it("car paid in cash needs price and extras upfront", () => {
    expect(goalFigures({ type: "vehicle", details: car })).toEqual({ upfrontMinor: 8_60_000_00, costTotalMinor: null, loan: null });
  });

  it("car loan with a down payment finances the rest", () => {
    const figures = goalFigures({
      type: "vehicle",
      details: { ...car, payment: "loan_down_payment", downPaymentMinor: 2_00_000_00, loanRateBps: 950, loanMonths: 60 },
    });
    expect(figures.upfrontMinor).toBe(2_60_000_00);
    expect(figures.loan).toEqual({
      principalMinor: 6_00_000_00,
      annualRateBps: 950,
      months: 60,
      ...emi({ principalMinor: 6_00_000_00, annualRateBps: 950, months: 60 }),
    });
  });

  it("full car loan leaves only the extras upfront", () => {
    const figures = goalFigures({ type: "vehicle", details: { ...car, payment: "loan", loanRateBps: 950, loanMonths: 60 } });
    expect(figures.upfrontMinor).toBe(60_000_00);
    expect(figures.loan?.principalMinor).toBe(8_00_000_00);
  });

  it("house loan: ₹10 lakh after the down payment at 8.5% for 20 years", () => {
    const house: HouseDetails = {
      v: 1,
      purpose: "buy",
      city: "Pune",
      payment: "loan_down_payment",
      priceMinor: 12_50_000_00,
      downPaymentMinor: 2_50_000_00,
      loanRateBps: 850,
      loanMonths: 240,
    };
    const figures = goalFigures({ type: "house", details: house });
    expect(figures.upfrontMinor).toBe(2_50_000_00);
    expect(figures.loan).toMatchObject({ principalMinor: 10_00_000_00, emiMinor: 867_823, totalInterestMinor: 108_277_576 });
  });

  it("rejects a down payment above the price", () => {
    expect(() =>
      goalFigures({ type: "vehicle", details: { ...car, payment: "loan_down_payment", downPaymentMinor: 9_00_000_00, loanRateBps: 950, loanMonths: 60 } }),
    ).toThrow(RangeError);
  });

  const phone: ItemDetails = { v: 1, item: "Phone", payment: "no_cost_emi", priceMinor: 60_000_00, emiRateBps: null, emiMonths: 6 };

  it("no-cost EMI: nothing upfront, no interest", () => {
    expect(goalFigures({ type: "mobile", details: phone })).toEqual({
      upfrontMinor: 0,
      costTotalMinor: null,
      loan: { principalMinor: 60_000_00, annualRateBps: 0, months: 6, emiMinor: 10_000_00, totalInterestMinor: 0, totalPayableMinor: 60_000_00 },
    });
  });

  it("EMI with interest uses the entered rate", () => {
    const figures = goalFigures({ type: "electronics", details: { ...phone, payment: "emi", emiRateBps: 1_599, emiMonths: 9, priceMinor: 10_000_00 } });
    expect(figures.loan).toMatchObject({ emiMinor: 118_645, totalInterestMinor: 67_801 });
  });

  it("cash item needs the price upfront; other goals use the entered amount", () => {
    expect(goalFigures({ type: "furniture", details: { ...phone, payment: "cash", emiMonths: null } }).upfrontMinor).toBe(60_000_00);
    expect(goalFigures({ type: "other", details: { v: 1, description: "Wedding gift" } }).upfrontMinor).toBeNull();
  });
});

describe("budgetsForMonth", () => {
  const rows: BudgetRow[] = [
    { categoryId: "food", effectiveFrom: "2026-08-01", amountMinor: 10_000_00, currency: "INR" },
    { categoryId: "food", effectiveFrom: "2026-10-01", amountMinor: 12_000_00, currency: "INR" },
    { categoryId: "fuel", effectiveFrom: "2026-09-01", amountMinor: 3_000_00, currency: "INR" },
    { categoryId: "fuel", effectiveFrom: "2026-11-01", amountMinor: 0, currency: "INR" },
  ];

  it("uses the latest row at or before the month", () => {
    const sep = budgetsForMonth(rows, "2026-09-15");
    expect(sep.get("food")?.amountMinor).toBe(10_000_00);
    expect(sep.get("fuel")?.amountMinor).toBe(3_000_00);
    expect(budgetsForMonth(rows, "2026-10-31").get("food")?.amountMinor).toBe(12_000_00);
    expect(budgetsForMonth(rows, "2026-07-31").size).toBe(0);
  });

  it("drops a category whose latest amount is 0", () => {
    const nov = budgetsForMonth(rows, "2026-11-01");
    expect(nov.has("fuel")).toBe(false);
    expect(nov.get("food")?.amountMinor).toBe(12_000_00);
  });
});

describe("budgetStatus", () => {
  it("warns at exactly 80% and is over at exactly 100%", () => {
    expect(budgetStatus(7_999, 10_000).level).toBe("ok");
    expect(budgetStatus(8_000, 10_000).level).toBe("warning");
    expect(budgetStatus(9_999, 10_000).level).toBe("warning");
    expect(budgetStatus(10_000, 10_000).level).toBe("over");
    expect(budgetStatus(12_500, 10_000)).toEqual({ spentMinor: 12_500, budgetMinor: 10_000, usedBps: 12_500, leftMinor: -2_500, level: "over" });
  });

  it("decides the level exactly, not from the rounded percentage", () => {
    // 79.995% rounds to 8,000 bp but is still below the 80% warning.
    const s = budgetStatus(79_995, 100_000);
    expect(s.usedBps).toBe(8_000);
    expect(s.level).toBe("ok");
  });

  it("needs a budget above zero", () => {
    expect(() => budgetStatus(0, 0)).toThrow(RangeError);
  });
});
