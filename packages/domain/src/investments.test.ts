import { describe, expect, it } from "vitest";
import {
  MAX_PRICE_SCALED,
  MAX_UNITS_SCALED,
  formatPriceScaled,
  formatUnits,
  groupHoldings,
  holdingFigures,
  identifierChanged,
  investedMinorWithinLimit,
  isOldPrice,
  parseScaledInput,
  portfolioTotals,
  priceAge,
  scaledToDecimalString,
  type HoldingRecord,
} from "./investments";

// Expected values were computed independently with Python's decimal module
// (ROUND_HALF_UP, which rounds halves away from zero), not with this code.

const rec = (instrumentId: string, unitsScaled: number, buyPriceScaled: number): HoldingRecord => ({
  instrumentId,
  unitsScaled,
  buyPriceScaled,
});

describe("holdingFigures", () => {
  it("values a record and rounds each figure once", () => {
    // 10.5 units bought at ₹100.25, now ₹120.3333.
    expect(holdingFigures(rec("a", 105_000, 1_002_500), 1_203_333)).toEqual({
      investedMinor: 105_263, // ₹1,052.625
      valueMinor: 126_350, // ₹1,263.49965
      profitMinor: 21_087, // ₹210.87465
      profitBps: 2_003,
    });
  });

  it("rounds half a paisa away from zero, for gains and losses", () => {
    expect(holdingFigures(rec("a", 10_000, 100_000), 100_050)).toEqual({
      investedMinor: 1_000,
      valueMinor: 1_001,
      profitMinor: 1,
      profitBps: 5,
    });
    expect(holdingFigures(rec("a", 10_000, 100_050), 100_000)).toEqual({
      investedMinor: 1_001,
      valueMinor: 1_000,
      profitMinor: -1,
      profitBps: -5,
    });
  });

  it("gives no value or profit when the price is missing or 0", () => {
    const none = { investedMinor: 1_001, valueMinor: null, profitMinor: null, profitBps: null };
    expect(holdingFigures(rec("a", 10_000, 100_050), null)).toEqual(none);
    expect(holdingFigures(rec("a", 10_000, 100_050), 0)).toEqual(none);
  });

  it("allows a buy price of 0 (profit but no percentage)", () => {
    expect(holdingFigures(rec("a", 50_000, 0), 1_000_000)).toEqual({
      investedMinor: 0,
      valueMinor: 50_000,
      profitMinor: 50_000,
      profitBps: null,
    });
  });

  it("handles the smallest 4-decimal units and prices", () => {
    // 0.0001 units at ₹0.0001, now ₹9,999.9999.
    expect(holdingFigures(rec("a", 1, 1), 99_999_999)).toEqual({
      investedMinor: 0,
      valueMinor: 100,
      profitMinor: 100,
      profitBps: 999_999_980_000,
    });
  });

  it("stays exact at 10^13 paise invested", () => {
    // 10^9 units at ₹100, now ₹100.0001.
    expect(holdingFigures(rec("a", MAX_UNITS_SCALED, 1_000_000), 1_000_001)).toEqual({
      investedMinor: 10_000_000_000_000,
      valueMinor: 10_000_010_000_000,
      profitMinor: 10_000_000,
      profitBps: 0,
    });
  });

  it("refuses amounts it can't hold exactly and invalid inputs", () => {
    expect(() => holdingFigures(rec("a", MAX_UNITS_SCALED, MAX_PRICE_SCALED), null)).toThrow(RangeError);
    expect(() => holdingFigures(rec("a", 0, 100), 100)).toThrow(RangeError);
    expect(() => holdingFigures(rec("a", -1, 100), 100)).toThrow(RangeError);
    expect(() => holdingFigures(rec("a", 1.5, 100), 100)).toThrow(RangeError);
    expect(() => holdingFigures(rec("a", 1, -1), 100)).toThrow(RangeError);
    expect(() => holdingFigures(rec("a", 1, 1), MAX_PRICE_SCALED + 1)).toThrow(RangeError);
  });
});

const prices: Record<string, number | null> = { a: 1_305_000, b: 24_001_000, c: null };
const priceOf = (id: string) => prices[id] ?? null;

// a: 10 units at ₹100 and 5.5 units at ₹120.1234, now ₹130.50
// b: 3 units at ₹2,500.75, now ₹2,400.10; c: 2 units at ₹50, no price
const records = [
  rec("a", 100_000, 1_000_000),
  rec("b", 30_000, 25_007_500),
  rec("a", 55_000, 1_201_234),
  rec("c", 20_000, 500_000),
];

describe("groupHoldings", () => {
  const groups = groupHoldings(records, priceOf);

  it("groups by instrument with total units and weighted average buy price", () => {
    expect(groups.map((g) => g.instrumentId)).toEqual(["a", "b", "c"]);
    expect(groups[0]).toMatchObject({
      totalUnitsScaled: 155_000,
      averageBuyPriceScaled: 1_071_406, // ₹1,660.6787 / 15.5 = ₹107.14056…
      figures: { investedMinor: 166_068, valueMinor: 202_275, profitMinor: 36_207, profitBps: 2_180 },
    });
    expect(groups[0]?.records).toHaveLength(2);
    expect(groups[1]?.figures).toEqual({ investedMinor: 750_225, valueMinor: 720_030, profitMinor: -30_195, profitBps: -402 });
    expect(groups[2]?.figures).toEqual({ investedMinor: 10_000, valueMinor: null, profitMinor: null, profitBps: null });
  });

  it("rounds a group's total once, not row by row", () => {
    // Two records of half a paisa each: rows show ₹0.01 each, the group ₹0.01.
    const [group] = groupHoldings([rec("x", 10_000, 50), rec("x", 10_000, 50)], () => 100);
    expect(holdingFigures(rec("x", 10_000, 50), 100).investedMinor).toBe(1);
    expect(group?.figures.investedMinor).toBe(1);
    expect(group?.averageBuyPriceScaled).toBe(50);
  });
});

describe("portfolioTotals", () => {
  it("totals priced records and counts the rest", () => {
    expect(portfolioTotals(records, priceOf)).toEqual({
      investedMinor: 926_293,
      pricedInvestedMinor: 916_293,
      valueMinor: 922_305,
      profitMinor: 6_012,
      profitBps: 66,
      pricedCount: 3,
      unpricedCount: 1,
    });
  });

  it("reconciles with the groups to within half a paisa per group", () => {
    const totals = portfolioTotals(records, priceOf);
    const groups = groupHoldings(records, priceOf);
    const sum = groups.reduce((s, g) => s + g.figures.investedMinor, 0);
    expect(Math.abs(sum - totals.investedMinor)).toBeLessThanOrEqual(groups.length / 2);
  });

  it("is all zeros for no records", () => {
    expect(portfolioTotals([], priceOf)).toEqual({
      investedMinor: 0,
      pricedInvestedMinor: 0,
      valueMinor: 0,
      profitMinor: 0,
      profitBps: null,
      pricedCount: 0,
      unpricedCount: 0,
    });
  });
});

describe("price age and identifier changes", () => {
  it("marks a price as old after 7 days", () => {
    expect(isOldPrice("2026-10-19", "2026-10-26")).toBe(false);
    expect(isOldPrice("2026-10-19", "2026-10-27")).toBe(true);
    expect(isOldPrice("2028-02-22", "2028-03-01")).toBe(true); // across 29 February
  });

  it("ages a price: fresh up to 7 days, old after 7, stale after 30", () => {
    expect(priceAge("2026-10-19", "2026-10-26")).toBe("fresh");
    expect(priceAge("2026-10-19", "2026-10-27")).toBe("old");
    expect(priceAge("2026-09-26", "2026-10-26")).toBe("old"); // exactly 30 days
    expect(priceAge("2026-09-25", "2026-10-26")).toBe("stale");
    expect(priceAge("2028-01-30", "2028-03-01")).toBe("stale"); // 31 days across 29 February
  });

  it("flags a changed ISIN only when both are known", () => {
    expect(identifierChanged("INE000X01011", "INE000X01029")).toBe(true);
    expect(identifierChanged("INE000X01011", "INE000X01011")).toBe(false);
    expect(identifierChanged(null, "INE000X01011")).toBe(false);
    expect(identifierChanged("INE000X01011", null)).toBe(false);
  });
});

describe("parseScaledInput", () => {
  const max = MAX_UNITS_SCALED;
  it("reads up to 4 decimals exactly", () => {
    expect(parseScaledInput("1,234.5678", { max })).toEqual({ ok: true, scaled: 12_345_678 });
    expect(parseScaledInput("₹ 0.0001", { max })).toEqual({ ok: true, scaled: 1 });
    expect(parseScaledInput(".5", { max })).toEqual({ ok: true, scaled: 5_000 });
    expect(parseScaledInput("1000000000", { max })).toEqual({ ok: true, scaled: MAX_UNITS_SCALED });
    expect(parseScaledInput("0", { max, allowZero: true })).toEqual({ ok: true, scaled: 0 });
  });

  it("rejects what it can't store exactly", () => {
    expect(parseScaledInput("", { max })).toEqual({ ok: false, error: "empty" });
    expect(parseScaledInput("1.23456", { max })).toEqual({ ok: false, error: "too_many_decimals" });
    expect(parseScaledInput("0.0000", { max })).toEqual({ ok: false, error: "zero" });
    expect(parseScaledInput("1000000000.0001", { max })).toEqual({ ok: false, error: "too_large" });
    for (const text of ["-1", "1e3", "abc", ".", "1.2.3"]) {
      expect(parseScaledInput(text, { max })).toEqual({ ok: false, error: "invalid" });
    }
  });
});

describe("investedMinorWithinLimit", () => {
  it("allows up to 10^13 paise invested", () => {
    expect(investedMinorWithinLimit(MAX_UNITS_SCALED, 1_000_000)).toBe(10_000_000_000_000);
    expect(investedMinorWithinLimit(MAX_UNITS_SCALED, 1_000_001)).toBeNull();
    expect(investedMinorWithinLimit(105_000, 1_002_500)).toBe(105_263);
  });
});

describe("display of units and prices", () => {
  it("writes scaled values as exact decimals", () => {
    expect(scaledToDecimalString(125_000)).toBe("12.5");
    expect(scaledToDecimalString(12_505_000, 2)).toBe("1250.50");
    expect(scaledToDecimalString(1)).toBe("0.0001");
    expect(scaledToDecimalString(MAX_PRICE_SCALED, 2)).toBe("1000000000.00");
    expect(scaledToDecimalString(0)).toBe("0");
  });

  it("formats units and prices with Indian grouping", () => {
    expect(formatUnits(12_345_678)).toBe("1,234.5678");
    expect(formatUnits(1_000_000_000)).toBe("1,00,000");
    expect(formatPriceScaled(12_505_000)).toBe("₹1,250.50");
    expect(formatPriceScaled(287_924)).toBe("₹28.7924");
    expect(formatPriceScaled(MAX_PRICE_SCALED)).toBe("₹1,00,00,00,000.00");
  });
});
