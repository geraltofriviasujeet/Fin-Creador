import { describe, expect, it } from "vitest";
import {
  KEYPAD_ROWS,
  MINUS,
  amountInputState,
  applyKeypadKey,
  balanceChangeLabel,
  clampProgress,
  formatAmount,
  hitSlopFor,
  isWarning,
  keypadKeyLabel,
  listRowLabel,
  progressA11y,
  progressOf,
  tapSize,
} from "./logic";

describe("formatAmount (AmountText)", () => {
  it("uses Indian digit grouping and whole rupees by default", () => {
    expect(formatAmount(1_234_567_89).text).toBe("₹12,34,568");
    expect(formatAmount(1_00_000_00).text).toBe("₹1,00,000");
  });

  it("keeps paise when whole is false", () => {
    expect(formatAmount(125_050, { whole: false }).text).toBe("₹1,250.50");
    expect(formatAmount(125_000, { whole: false }).text).toBe("₹1,250");
  });

  it("money out has a minus sign and is ink, not colour alone", () => {
    const out = formatAmount(125_000, { direction: "out" });
    expect(out.text).toBe(`${MINUS}₹1,250`);
    expect(out.tone).toBe("ink");
    expect(out.label).toBe("Money out, ₹1,250");
  });

  it("money in has a plus sign, green tone and a spoken label", () => {
    const inc = formatAmount(42_000_00, { direction: "in" });
    expect(inc.text).toBe("+₹42,000");
    expect(inc.tone).toBe("moneyIn");
    expect(inc.label).toBe("Money in, ₹42,000");
  });

  it("direction wins over the sign of the stored amount", () => {
    expect(formatAmount(-125_000, { direction: "out" }).text).toBe(`${MINUS}₹1,250`);
    expect(formatAmount(-125_000, { direction: "in" }).text).toBe("+₹1,250");
  });

  it("a negative neutral figure shows a minus in warning colour", () => {
    const short = formatAmount(-198_000);
    expect(short.text).toBe(`${MINUS}₹1,980`);
    expect(short.tone).toBe("warning");
    expect(short.label).toBe("Minus ₹1,980");
  });

  it("zero has no sign", () => {
    expect(formatAmount(0).text).toBe("₹0");
  });

  it("rounds half away from zero to whole rupees", () => {
    expect(formatAmount(133_389_50).text).toBe("₹1,33,390");
    expect(formatAmount(133_389_49).text).toBe("₹1,33,389");
  });

  it("formats other currencies with their own symbol", () => {
    expect(formatAmount(1_234_56, { currency: "USD", locale: "en-US", whole: false }).text).toBe("$1,234.56");
  });
});

describe("tap targets", () => {
  it("hitSlop grows small controls to 44×44", () => {
    const slop = hitSlopFor(36, 36);
    expect(slop).toEqual({ top: 4, bottom: 4, left: 4, right: 4 });
    expect(tapSize(36, slop?.top)).toBeGreaterThanOrEqual(44);
    expect(tapSize(28, hitSlopFor(28)?.top)).toBeGreaterThanOrEqual(44);
    expect(tapSize(31, hitSlopFor(31)?.top)).toBeGreaterThanOrEqual(44);
  });

  it("no hitSlop when already 44 or more", () => {
    expect(hitSlopFor(44)).toBeUndefined();
    expect(hitSlopFor(56, 120)).toBeUndefined();
  });

  it("only the short axis gets slop", () => {
    expect(hitSlopFor(32, 120)).toEqual({ top: 6, bottom: 6, left: 0, right: 0 });
  });
});

describe("number keypad", () => {
  const type = (keys: string[], start = "") =>
    keys.reduce((acc, k) => applyKeypadKey(acc, k as never), start);

  it("builds an amount digit by digit", () => {
    expect(type(["1", "2", "5", "0"])).toBe("1250");
    expect(type(["1", "2", "5", "0", ".", "5"])).toBe("1250.5");
  });

  it("ignores a second point and a third decimal", () => {
    expect(type(["1", ".", ".", "2", "3", "4"])).toBe("1.23");
  });

  it("starts with 0. when the point comes first and drops a lone leading zero", () => {
    expect(type([".", "5"])).toBe("0.5");
    expect(type(["0", "0", "7"])).toBe("7");
  });

  it("delete removes the last character", () => {
    expect(type(["1", "2", "back"])).toBe("1");
    expect(type(["back"])).toBe("");
  });

  it("caps the number of whole digits", () => {
    expect(type(Array(15).fill("9"))).toHaveLength(11);
  });

  it("has no decimal point for zero-decimal currencies", () => {
    expect(applyKeypadKey("12", ".", "JPY")).toBe("12");
  });

  it("every key has a spoken label", () => {
    for (const row of KEYPAD_ROWS) for (const key of row) expect(keypadKeyLabel(key)).not.toBe("");
    expect(keypadKeyLabel("back")).toBe("Delete last digit");
  });
});

describe("amount input", () => {
  it("shows Indian grouping while typing and parses to paise", () => {
    expect(amountInputState("125000")).toMatchObject({ display: "₹1,25,000", minor: 125_000_00 });
    expect(amountInputState("1250.")).toMatchObject({ display: "₹1,250.", minor: 125_000 });
    expect(amountInputState("1250.50")).toMatchObject({ display: "₹1,250.50", minor: 125_050 });
  });

  it("empty input shows ₹0 and has no value", () => {
    expect(amountInputState("")).toEqual({ display: "₹0", minor: null, label: "Amount, empty" });
  });
});

describe("progress", () => {
  it("clamps for drawing and handles bad input", () => {
    expect(clampProgress(1.4)).toBe(1);
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(Number.NaN)).toBe(0);
  });

  it("computes progress from minor units", () => {
    expect(progressOf(4_500_00, 10_000_00)).toBe(0.45);
    expect(progressOf(100, 0)).toBe(1);
    expect(progressOf(0, 0)).toBe(0);
  });

  it("warns strictly above 90%", () => {
    expect(isWarning(0.9)).toBe(false);
    expect(isWarning(0.91)).toBe(true);
    expect(isWarning(0.99, null)).toBe(false);
  });

  it("speaks the percentage and the warning, not only a colour", () => {
    expect(progressA11y(0.45).text).toBe("45 percent");
    expect(progressA11y(0.95).text).toBe("95 percent, almost used up");
    expect(progressA11y(1.2)).toMatchObject({ now: 100, text: "120 percent, over the limit" });
  });
});

describe("accessibility labels", () => {
  it("list row reads title, subtitle, tag and amount", () => {
    expect(
      listRowLabel({ title: "Swiggy", subtitle: "Food · HDFC", tag: "Imported", amountLabel: "Money out, ₹420" }),
    ).toBe("Swiggy, Food · HDFC, Imported, Money out, ₹420");
    expect(listRowLabel({ title: "Rent" })).toBe("Rent");
  });

  it("balance card says before, after and any shortfall", () => {
    const ok = balanceChangeLabel("SBI", 12_400_00, 11_150_00);
    expect(ok.label).toBe("SBI, ₹12,400 now, ₹11,150 after this");
    expect(ok.short).toBeNull();
    const short = balanceChangeLabel("SBI", 18_000_00, -1_980_00);
    expect(short.after.text).toBe(`${MINUS}₹1,980`);
    expect(short.short).toBe("Leaves you ₹1,980 short");
    expect(short.label).toBe("SBI, ₹18,000 now, Minus ₹1,980 after this. Leaves you ₹1,980 short");
  });
});
