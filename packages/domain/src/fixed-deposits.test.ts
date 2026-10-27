import { describe, expect, it } from "vitest";
import { type FixedDeposit, addMonthsClamped, addPortfolioTotals, fdFigures, fdPortfolioTotals, fdValueOn } from "./fixed-deposits";
import { portfolioTotals } from "./investments";

// Expected values were computed independently with Python's fractions module (its own
// month arithmetic with calendar.monthrange), rounded half away from zero, not with this code.

const fd = (over: Partial<FixedDeposit>): FixedDeposit => ({
  principalMinor: 10_000_000, // ₹1,00,000
  rateBps: 725,
  compounding: "quarterly",
  startDate: "2025-01-15",
  maturityDate: "2026-01-15",
  ...over,
});

describe("addMonthsClamped", () => {
  it("clamps to the end of the month, from the start date each time", () => {
    expect(addMonthsClamped("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsClamped("2025-01-31", 2)).toBe("2025-03-31");
    expect(addMonthsClamped("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonthsClamped("2025-11-30", 3)).toBe("2026-02-28");
  });
});

describe("fdValueOn", () => {
  it("₹1,00,000 at 7.25% quarterly for a year", () => {
    const d = fd({});
    expect(fdValueOn(d, "2026-01-15")).toBe(10_744_950); // 4 whole quarters
    expect(fdValueOn(d, "2025-04-15")).toBe(10_181_250); // exactly one quarter
    expect(fdValueOn(d, "2025-07-01")).toBe(10_336_967); // 1 quarter + 77 days of simple interest
    expect(fdValueOn(d, "2025-01-15")).toBe(10_000_000); // the start date
    expect(fdValueOn(d, "2024-12-01")).toBe(10_000_000); // before the start
    expect(fdValueOn(d, "2027-01-01")).toBe(10_744_950); // capped at maturity
  });

  it("leap year: a 29 February start compounds yearly on 28 February", () => {
    const d = fd({ principalMinor: 5_000_000, rateBps: 700, compounding: "yearly", startDate: "2024-02-29", maturityDate: "2026-02-28" });
    expect(fdValueOn(d, "2025-02-28")).toBe(5_350_000);
    expect(fdValueOn(d, "2025-03-01")).toBe(5_351_026);
    expect(fdValueOn(d, "2026-02-28")).toBe(5_724_500);
  });

  it("month-end starts: 31 January monthly and 31 August half-yearly", () => {
    const monthly = fd({ principalMinor: 2_500_000, rateBps: 650, compounding: "monthly", startDate: "2025-01-31", maturityDate: "2025-07-31" });
    expect(fdValueOn(monthly, "2025-02-28")).toBe(2_513_542);
    expect(fdValueOn(monthly, "2025-03-01")).toBe(2_513_989);
    expect(fdValueOn(monthly, "2025-03-31")).toBe(2_527_157);
    expect(fdValueOn(monthly, "2025-07-31")).toBe(2_582_358);
    const halfYearly = fd({ rateBps: 800, compounding: "half_yearly", startDate: "2023-08-31", maturityDate: "2025-02-28" });
    expect(fdValueOn(halfYearly, "2024-02-29")).toBe(10_400_000);
    expect(fdValueOn(halfYearly, "2024-08-31")).toBe(10_816_000);
    expect(fdValueOn(halfYearly, "2025-02-28")).toBe(11_248_640);
  });

  it("rate 0 keeps the principal", () => {
    const d = fd({ principalMinor: 1_234_567, rateBps: 0, startDate: "2025-01-01", maturityDate: "2026-01-01" });
    expect(fdValueOn(d, "2025-06-30")).toBe(1_234_567);
    expect(fdValueOn(d, "2026-01-01")).toBe(1_234_567);
  });

  it("a tenure shorter than one period earns simple interest only", () => {
    const d = fd({ principalMinor: 5_000_000, rateBps: 700, startDate: "2025-03-10", maturityDate: "2025-04-24" });
    expect(fdValueOn(d, "2025-04-01")).toBe(5_021_096);
    expect(fdValueOn(d, "2025-04-24")).toBe(5_043_151);
  });

  it("an odd tenure (400 days) ends with a partial quarter", () => {
    const d = fd({ principalMinor: 7_777_777, rateBps: 715, startDate: "2025-05-31", maturityDate: "2026-07-05" });
    expect(fdValueOn(d, "2025-08-31")).toBe(7_916_805);
    expect(fdValueOn(d, "2025-09-01")).toBe(7_918_356);
    expect(fdValueOn(d, "2026-07-05")).toBe(8_406_219);
  });

  it("stays exact at the limits: ₹10^11 at 25% monthly for 10 years", () => {
    const d = fd({ principalMinor: 10_000_000_000_000, rateBps: 2_500, compounding: "monthly", startDate: "2016-10-27", maturityDate: "2026-10-27" });
    expect(fdValueOn(d, "2026-10-27")).toBe(118_735_645_703_531);
  });

  it("refuses what the database refuses", () => {
    expect(() => fdValueOn(fd({ rateBps: 2_501 }), "2025-06-01")).toThrow(RangeError);
    expect(() => fdValueOn(fd({ principalMinor: 0 }), "2025-06-01")).toThrow(RangeError);
    expect(() => fdValueOn(fd({ maturityDate: "2025-01-15" }), "2025-06-01")).toThrow(RangeError);
    expect(() => fdValueOn(fd({ maturityDate: "2035-01-16" }), "2025-06-01")).toThrow(RangeError); // over 10 years
  });
});

describe("fdFigures", () => {
  it("before maturity: accrued value today, interest at maturity and days left", () => {
    expect(fdFigures(fd({}), "2025-07-01")).toEqual({
      maturityValueMinor: 10_744_950,
      interestMinor: 744_950,
      accruedValueMinor: 10_336_967,
      accruedInterestMinor: 336_967,
      daysLeft: 198,
      matured: false,
    });
  });

  it("matured: accrued equals the maturity value and no days are left", () => {
    expect(fdFigures(fd({}), "2026-01-15")).toMatchObject({ accruedValueMinor: 10_744_950, daysLeft: 0, matured: true });
    expect(fdFigures(fd({}), "2026-10-27")).toMatchObject({ accruedValueMinor: 10_744_950, daysLeft: 0, matured: true });
  });
});

describe("totals with holdings", () => {
  it("adds deposits (principal, value today, accrued interest) to holdings totals", () => {
    const deposits = fdPortfolioTotals([
      { principalMinor: 10_000_000, figures: fdFigures(fd({}), "2025-07-01") }, // ₹1,03,369.67 today
      { principalMinor: 2_500_000, figures: fdFigures(fd({ principalMinor: 2_500_000, rateBps: 0 }), "2025-07-01") },
    ]);
    expect(deposits).toEqual({
      investedMinor: 12_500_000,
      pricedInvestedMinor: 12_500_000,
      valueMinor: 12_836_967,
      profitMinor: 336_967,
      profitBps: 270, // 3,369.67 / 1,25,000 = 2.6957%
      pricedCount: 2,
      unpricedCount: 0,
    });
    const holdings = portfolioTotals([{ instrumentId: "a", unitsScaled: 100_000, buyPriceScaled: 10_000_000 }], () => 12_000_000); // 10 × ₹1,000 → ₹1,200
    expect(addPortfolioTotals(holdings, deposits)).toMatchObject({ investedMinor: 13_500_000, valueMinor: 14_036_967, profitMinor: 536_967, profitBps: 398 });
    expect(addPortfolioTotals(holdings, fdPortfolioTotals([]))).toBe(holdings);
    expect(addPortfolioTotals(portfolioTotals([], () => null), deposits)).toBe(deposits);
  });
});
