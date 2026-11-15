import { describe, expect, it } from "vitest";
import { INCOME_TAX_2026_27, parseRupeeAmount, rupeeAmountsIn, salaryTaxEstimate, taxAgeBand, taxOnTaxableIncome } from "./income-tax";

// The documents' own worked examples are checked against these functions in
// scripts/income-tax-documents.test.ts (it reads the approved documents).

describe("salaryTaxEstimate", () => {
  it("gross ₹14,15,000, under 60, no deductions: new ₹84,240, old ₹2,30,880", () => {
    const e = salaryTaxEstimate({ grossSalary: 1_415_000, ageBand: "under_60" });
    expect(e.new).toMatchObject({ standardDeduction: 75_000, taxableIncome: 1_340_000, slabTax: 81_000, rebate: 0, surcharge: 0, cess: 3_240, total: 84_240, wholeRupees: true });
    expect(e.new.slabs.map((s) => [s.ratePct, s.income, s.tax])).toEqual([
      [0, 400_000, 0],
      [5, 400_000, 20_000],
      [10, 400_000, 40_000],
      [15, 140_000, 21_000],
    ]);
    expect(e.old).toMatchObject({ standardDeduction: 50_000, deductions: 0, taxableIncome: 1_365_000, slabTax: 222_000, rebate: 0, cess: 8_880, total: 230_880 });
    expect(e).toMatchObject({ taxYear: "2026-27", lower: "new", difference: 146_640 });
  });

  it("taxable income of ₹12,00,000 under the new regime: the rebate takes it to nil", () => {
    const t = taxOnTaxableIncome("new", 1_200_000, "under_60");
    expect(t).toMatchObject({ slabTax: 60_000, rebate: 60_000, rebateRelief: false, taxAfterRebate: 0, cess: 0, total: 0 });
  });

  it("just above ₹12,00,000: the tax is never more than the income above it (rebate relief)", () => {
    const t = taxOnTaxableIncome("new", 1_210_000, "under_60");
    expect(t).toMatchObject({ slabTax: 61_500, rebate: 51_500, rebateRelief: true, taxAfterRebate: 10_000, cess: 400, total: 10_400 });
    // Relief ends where the tax no longer exceeds the income above ₹12,00,000.
    const later = taxOnTaxableIncome("new", 1_300_000, "under_60");
    expect(later).toMatchObject({ slabTax: 75_000, rebate: 0, rebateRelief: false, taxAfterRebate: 75_000 });
  });

  it("surcharge above ₹50 lakh at 10%, with no relief needed well above the threshold", () => {
    const t = salaryTaxEstimate({ grossSalary: 6_075_000, ageBand: "under_60" }).new;
    expect(t).toMatchObject({ taxableIncome: 6_000_000, slabTax: 1_380_000, surchargeRatePct: 10, surcharge: 138_000, surchargeRelief: 0, cess: 60_720, total: 1_578_720 });
  });

  it("marginal relief just above a surcharge threshold, new regime", () => {
    // At ₹50,00,000 tax is ₹10,80,000 with no surcharge; ₹10,000 above it, tax plus surcharge is capped at ₹10,90,000.
    const t = taxOnTaxableIncome("new", 5_010_000, "under_60");
    expect(t).toMatchObject({ slabTax: 1_083_000, surchargeRatePct: 10, surcharge: 7_000, surchargeRelief: 101_300, cess: 43_600, total: 1_133_600 });
  });

  it("the old regime's top surcharge applies above ₹5 crore; the new regime stops at 25%", () => {
    expect(taxOnTaxableIncome("old", 60_000_000, "under_60").surchargeRatePct).toBe(37);
    expect(taxOnTaxableIncome("new", 60_000_000, "under_60").surchargeRatePct).toBe(25);
  });

  it("applies the steps in order: slab tax → rebate → surcharge on the tax after rebate → cess on tax plus surcharge", () => {
    for (const regime of ["new", "old"] as const) {
      for (let taxable = 0; taxable <= 60_000_000; taxable += taxable < 3_000_000 ? 12_345 : 987_653) {
        const t = taxOnTaxableIncome(regime, taxable, "under_60");
        const exact = t.wholeRupees ? 0 : 2;
        expect(t.slabs.reduce((s, l) => s + l.tax, 0)).toBeCloseTo(t.slabTax, -1);
        expect(Math.abs(t.taxAfterRebate - (t.slabTax - t.rebate))).toBeLessThanOrEqual(exact);
        expect(Math.abs(t.surcharge + t.surchargeRelief - Math.round((t.taxAfterRebate * t.surchargeRatePct) / 100))).toBeLessThanOrEqual(exact + 1);
        expect(Math.abs(t.cess - Math.round(((t.taxAfterRebate + t.surcharge) * 4) / 100))).toBeLessThanOrEqual(exact);
        expect(Math.abs(t.total - (t.taxAfterRebate + t.surcharge + t.cess))).toBeLessThanOrEqual(exact);
        expect(t.total).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("never takes a standard deduction above the salary, and taxable income never goes below zero", () => {
    const small = salaryTaxEstimate({ grossSalary: 40_000, ageBand: "under_60", oldRegimeDeductions: 150_000 });
    expect(small.new).toMatchObject({ standardDeduction: 40_000, taxableIncome: 0, total: 0 });
    expect(small.old).toMatchObject({ standardDeduction: 40_000, deductions: 150_000, taxableIncome: 0, total: 0 });
    expect(small).toMatchObject({ lower: "same", difference: 0 });
  });

  it("counts deductions under the old regime only", () => {
    const e = salaryTaxEstimate({ grossSalary: 1_200_000, ageBand: "under_60", oldRegimeDeductions: 225_000 });
    expect(e.new).toMatchObject({ deductions: 0, taxableIncome: 1_125_000, total: 0 });
    expect(e.old).toMatchObject({ deductions: 225_000, taxableIncome: 925_000, total: 101_400 });
  });

  it("uses the age bands under the old regime only", () => {
    const at = (ageBand: "under_60" | "60_to_79" | "80_plus") => salaryTaxEstimate({ grossSalary: 750_000, ageBand });
    expect([at("under_60").old.total, at("60_to_79").old.total, at("80_plus").old.total]).toEqual([54_600, 52_000, 41_600]);
    expect(new Set([at("under_60").new.total, at("60_to_79").new.total, at("80_plus").new.total]).size).toBe(1);
  });

  it("says when a figure wasn't a whole rupee, and rounds it half up", () => {
    const t = taxOnTaxableIncome("new", 1_265_001, "under_60");
    expect(t.wholeRupees).toBe(false);
    expect(t.slabTax).toBe(69_750); // ₹69,750.15
  });

  it("refuses amounts that aren't whole, non-negative rupees", () => {
    expect(() => salaryTaxEstimate({ grossSalary: -1, ageBand: "under_60" })).toThrow(RangeError);
    expect(() => salaryTaxEstimate({ grossSalary: 10.5, ageBand: "under_60" })).toThrow(RangeError);
    expect(() => salaryTaxEstimate({ grossSalary: 100, ageBand: "under_60", oldRegimeDeductions: Number.NaN })).toThrow(RangeError);
  });

  it("keeps the table's slabs contiguous and rising", () => {
    for (const rules of Object.values(INCOME_TAX_2026_27)) {
      for (const slabs of Object.values(rules.slabs)) {
        slabs.forEach((s, i) => {
          if (i > 0) expect(s.from).toBe(slabs[i - 1]!.upTo);
          expect(s.upTo === null ? i === slabs.length - 1 : s.upTo > s.from).toBe(true);
        });
      }
    }
  });
});

describe("taxAgeBand", () => {
  it("bands ages at 60 and 80", () => {
    expect([taxAgeBand(35), taxAgeBand(59), taxAgeBand(60), taxAgeBand(79), taxAgeBand(80), taxAgeBand(150), taxAgeBand(60.5)]).toEqual([
      "under_60",
      "under_60",
      "60_to_79",
      "60_to_79",
      "80_plus",
      null,
      null,
    ]);
  });
});

describe("parseRupeeAmount", () => {
  it.each([
    ["1415000", 1_415_000, false],
    ["14,15,000", 1_415_000, false],
    ["₹14,15,000", 1_415_000, false],
    ["14.15 lakh", 1_415_000, false],
    ["14 lpa", 1_400_000, false],
    ["14L", 1_400_000, false],
    ["1.2 crore", 12_000_000, false],
    ["1.2 cr", 12_000_000, false],
    ["50k", 50_000, false],
    ["1.2 lakh a month", 120_000, true],
    ["1,18,000 per month", 118_000, true],
    ["95000 monthly", 95_000, true],
    ["14 lakh per annum", 1_400_000, false],
  ])("%s", (text, rupees, perMonth) => {
    expect(parseRupeeAmount(text)).toMatchObject({ rupees, perMonth });
  });

  it("refuses what isn't exactly one whole-rupee amount", () => {
    expect(parseRupeeAmount("1.234567 lakh")).toBeNull();
    expect(parseRupeeAmount("about 14 lakh")).toBeNull();
    expect(parseRupeeAmount("14 lakh and 2 lakh")).toBeNull();
    expect(parseRupeeAmount("thirty")).toBeNull();
  });
});

describe("rupeeAmountsIn", () => {
  it("finds each amount in a question, skipping ages and counts", () => {
    const found = rupeeAmountsIn("my in hand salary is 1415000, I am 45, and I put 1.5 lakh in 80C and pay 12k a month rent");
    expect(found.map((a) => [a.rupees, a.perMonth])).toEqual([
      [1_415_000, false],
      [150_000, false],
      [12_000, true],
    ]);
  });
});
