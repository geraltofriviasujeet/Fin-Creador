// Hermes (React Native) ships a partial Intl: on iOS Intl.NumberFormat has no formatToParts,
// DateTimeFormat.formatToParts returns a single literal part, and older builds ignore
// signDisplay. These tests imitate those engines in Node so CI catches a regression.
import { afterEach, describe, expect, it, vi } from "vitest";
import { currencySymbol } from "./currency";
import { localDateInTimeZone } from "./dates";
import { formatMoney, formatMoneyWhole, formatPercentFromBasisPoints } from "./format";
import { formatPriceScaled, formatUnits } from "./investments";
import { regroupAmountInput } from "./money";

const RealNumberFormat = Intl.NumberFormat;
const RealDateTimeFormat = Intl.DateTimeFormat;

/** An Intl whose NumberFormat has only format(), optionally grouping like en-US and ignoring signDisplay. */
function stubNumberFormat({ westernGrouping = false } = {}) {
  function NumberFormat(locale?: string, options?: Intl.NumberFormatOptions) {
    const rest = { ...options };
    delete rest.signDisplay;
    const real = new RealNumberFormat(westernGrouping ? "en-US" : locale, rest);
    return { format: (x: number) => real.format(x) };
  }
  vi.stubGlobal("Intl", Object.assign(Object.create(Intl), { NumberFormat }));
}

/** DateTimeFormat as on Hermes iOS: formatToParts returns the whole string as one literal. */
function stubDateTimeFormatOneLiteral() {
  function DateTimeFormat(locale?: string, options?: Intl.DateTimeFormatOptions) {
    const real = new RealDateTimeFormat(locale, options);
    return {
      format: (d: Date) => real.format(d),
      formatToParts: (d: Date) => [{ type: "literal", value: real.format(d) }],
    };
  }
  vi.stubGlobal("Intl", Object.assign(Object.create(Intl), { DateTimeFormat }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("money formatting without formatToParts or signDisplay (Hermes)", () => {
  it("keeps ₹ and lakh grouping", () => {
    stubNumberFormat();
    expect(currencySymbol("INR")).toBe("₹");
    expect(formatMoney(123_456_700, { currency: "INR" })).toBe("₹12,34,567");
    expect(formatMoney(123_456_750, { currency: "INR" })).toBe("₹12,34,567.50");
    expect(formatMoneyWhole(13_338_950, { currency: "INR" })).toBe("₹1,33,390");
  });

  it("still shows explicit signs when signDisplay is ignored", () => {
    stubNumberFormat();
    expect(formatMoney(12_800_000, { currency: "INR", signed: true })).toBe("+₹1,28,000");
    expect(formatMoney(-248_000, { currency: "INR", signed: true })).toBe("-₹2,480");
    expect(formatMoney(0, { currency: "INR", signed: true })).toBe("₹0");
    expect(formatPercentFromBasisPoints(840, { signed: true })).toBe("+8.4%");
    expect(formatPercentFromBasisPoints(-420, { signed: true })).toBe("-4.2%");
  });

  it("falls back to lakh grouping when the engine groups en-IN in thousands", () => {
    stubNumberFormat({ westernGrouping: true });
    expect(formatMoney(123_456_700, { currency: "INR" })).toBe("₹12,34,567");
    expect(formatMoney(1_00_00_000_00, { currency: "INR" })).toBe("₹1,00,00,000");
    expect(formatMoney(-123_456_750, { currency: "INR" })).toBe("-₹12,34,567.50");
    expect(regroupAmountInput("1234567", "INR")).toBe("12,34,567");
  });

  it("formats with strings alone when Intl.NumberFormat is missing", () => {
    vi.stubGlobal("Intl", Object.assign(Object.create(Intl), { NumberFormat: undefined }));
    expect(currencySymbol("INR")).toBe("₹");
    expect(currencySymbol("CHF")).toBe("CHF");
    expect(formatMoney(123_456_750, { currency: "INR" })).toBe("₹12,34,567.50");
    expect(formatPercentFromBasisPoints(5210)).toBe("52.1%");
  });

  it("still rejects an unknown currency code", () => {
    expect(() => formatMoney(100, { currency: "RUPEES" })).toThrow(RangeError);
  });
});

describe("dates in a time zone when formatToParts has no date parts (Hermes iOS)", () => {
  it.each([
    ["2026-03-31T19:00:00Z", "Asia/Kolkata", "2026-04-01"],
    ["2026-12-31T18:45:00Z", "Asia/Kolkata", "2027-01-01"],
    ["2026-12-31T18:45:00Z", "America/New_York", "2026-12-31"],
    ["2028-02-29T12:00:00Z", "UTC", "2028-02-29"],
  ])("%s in %s is %s", (instant, zone, expected) => {
    stubDateTimeFormatOneLiteral();
    expect(localDateInTimeZone(new Date(instant), zone)).toBe(expected);
  });

  it("works when formatToParts is missing", () => {
    const proto = RealDateTimeFormat.prototype as { formatToParts?: unknown };
    const saved = proto.formatToParts;
    delete proto.formatToParts;
    try {
      expect(localDateInTimeZone(new Date("2026-03-31T19:00:00Z"), "Asia/Kolkata")).toBe("2026-04-01");
    } finally {
      proto.formatToParts = saved;
    }
  });
});

describe("investment units and prices on an engine without a usable Intl (Hermes)", () => {
  it("formats with lakh grouping and never calls Intl.NumberFormat", () => {
    const NumberFormat = vi.fn(() => {
      throw new Error("Intl.NumberFormat must not be called");
    });
    vi.stubGlobal("Intl", Object.assign(Object.create(Intl), { NumberFormat }));
    expect(formatUnits(12_345_678)).toBe("1,234.5678");
    expect(formatUnits(1_000_000_000)).toBe("1,00,000");
    expect(formatPriceScaled(12_505_000)).toBe("₹1,250.50");
    expect(formatPriceScaled(287_924)).toBe("₹28.7924");
    expect(formatPriceScaled(10_000_000_000_000)).toBe("₹1,00,00,00,000.00");
    expect(NumberFormat).not.toHaveBeenCalled();
  });
});
