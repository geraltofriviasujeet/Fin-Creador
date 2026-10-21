import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatPercentFromBasisPoints,
  minorUnitsToDecimalString,
  ratioToBasisPoints,
} from "./format";

describe("minorUnitsToDecimalString", () => {
  it.each([
    [12345n, 2, "123.45"],
    [5, 2, "0.05"],
    [-5, 2, "-0.05"],
    [0, 2, "0.00"],
    [1000, 0, "1000"],
    [123456789012345678901234n, 2, "1234567890123456789012.34"],
  ])("%s with %i digits → %s", (amount, digits, expected) => {
    expect(minorUnitsToDecimalString(amount, digits)).toBe(expected);
  });

  it("rejects unsafe or fractional numbers", () => {
    expect(() => minorUnitsToDecimalString(1.5, 2)).toThrow(RangeError);
    expect(() => minorUnitsToDecimalString(2 ** 60, 2)).toThrow(RangeError);
  });
});

describe("formatMoney", () => {
  it("uses Indian digit grouping for INR", () => {
    expect(formatMoney(48_265_000, { currency: "INR" })).toBe("₹4,82,650");
    expect(formatMoney(1_00_00_000_00, { currency: "INR" })).toBe("₹1,00,00,000");
  });

  it("keeps paise when present", () => {
    expect(formatMoney(248_050, { currency: "INR" })).toBe("₹2,480.50");
  });

  it("shows explicit signs when signed", () => {
    expect(formatMoney(12_800_000, { currency: "INR", signed: true })).toBe("+₹1,28,000");
    expect(formatMoney(-248_000, { currency: "INR", signed: true })).toBe("-₹2,480");
    expect(formatMoney(0, { currency: "INR", signed: true })).toBe("₹0");
  });

  it("respects other currencies and locales", () => {
    expect(formatMoney(123_456, { currency: "USD", locale: "en-US" })).toBe("$1,234.56");
    expect(formatMoney(5000, { currency: "JPY", locale: "ja-JP" })).toBe("￥5,000");
  });

  it("formats bigint amounts exactly", () => {
    expect(formatMoney(900719925474099312n, { currency: "INR", trimZeroFraction: false })).toBe(
      "₹9,00,71,99,25,47,40,993.12",
    );
  });
});

describe("formatPercentFromBasisPoints", () => {
  it.each([
    [840, true, "+8.4%"],
    [-420, true, "-4.2%"],
    [5210, false, "52.1%"],
    [0, true, "0%"],
  ])("%i bp (signed=%s) → %s", (bp, signed, expected) => {
    expect(formatPercentFromBasisPoints(bp, { signed })).toBe(expected);
  });
});

describe("ratioToBasisPoints", () => {
  it.each([
    [6_824_000, 11_100_000, 6148],
    [1, 3, 3333],
    [2, 3, 6667],
    [1, 8, 1250],
    [-1, 8, -1250],
    [5, 5, 10_000],
    [0, 7, 0],
  ])("%s / %s → %s bp", (part, whole, expected) => {
    expect(ratioToBasisPoints(part, whole)).toBe(expected);
  });

  it("returns null for a zero denominator", () => {
    expect(ratioToBasisPoints(5, 0)).toBeNull();
  });
});
