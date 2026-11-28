import type { TransactionTotals } from "@fin-creador/api";
import { describe, expect, it } from "vitest";
import { dayTotalLabel, dayTotalText, pickerMonths, summaryText, visibleMonthChips, wholePercent } from "./activity-text";

const totals = (incomeMinor: number, expenseMinor: number, over: Partial<TransactionTotals> = {}): TransactionTotals => ({
  incomeMinor,
  expenseMinor,
  refundMinor: 0,
  netMinor: incomeMinor - expenseMinor,
  incomeCount: 1,
  expenseCount: 1,
  refundCount: 0,
  transferCount: 0,
  otherCurrencyCount: 0,
  ...over,
});

describe("summaryText", () => {
  it("shows whole rupees, the net as shown in minus shown out, and the savings rate", () => {
    const s = summaryText(totals(80_000_00, 22_600_00), "INR", null);
    expect(s).toMatchObject({ moneyIn: "₹80,000", moneyOut: "₹22,600", net: "Net +₹57,400", netTone: "moneyIn", rate: "72% saved", trend: null });
  });

  it("rounds each tile, so the three figures add up", () => {
    // ₹1,000.60 in, ₹500.40 out → ₹1,001 and ₹500; net ₹501 (exact ₹500.20).
    const s = summaryText(totals(1_000_60, 500_40), "INR", null);
    expect([s.moneyIn, s.moneyOut, s.net]).toEqual(["₹1,001", "₹500", "Net +₹501"]);
  });

  it("says when spending is above income, and when nothing came in", () => {
    expect(summaryText(totals(10_000_00, 13_000_00), "INR", null)).toMatchObject({ net: "Net −₹3,000", netTone: "warning", rate: "Spent ₹3,000 more than came in" });
    expect(summaryText(totals(0, 500_00), "INR", null)).toMatchObject({ rate: "No money in yet", net: "Net −₹500" });
    expect(summaryText(totals(0, 0), "INR", null)).toMatchObject({ net: "Net ₹0", netTone: "ink" });
  });

  it("compares the savings rate with the month before in whole points", () => {
    const previous = { totals: totals(80_000_00, 40_000_00), month: "2026-10-01" };
    expect(summaryText(totals(80_000_00, 22_600_00), "INR", previous).trend).toBe("+22 pts vs Oct 2026");
    expect(summaryText(totals(80_000_00, 60_000_00), "INR", previous).trend).toBe("−25 pts vs Oct 2026");
    // No income the month before: nothing to compare.
    expect(summaryText(totals(80_000_00, 22_600_00), "INR", { totals: totals(0, 100), month: "2026-10-01" }).trend).toBeNull();
  });
});

describe("day totals", () => {
  it("shows money in and out, exact like the rows", () => {
    expect(dayTotalText({ inMinor: 80_000_00, outMinor: 1_200_50 }, "INR")).toBe("+₹80,000 · −₹1,200.50");
    expect(dayTotalLabel({ inMinor: 80_000_00, outMinor: 1_200_50 }, "INR")).toBe("Money in ₹80,000, money out ₹1,200.50");
  });

  it("shows ₹0 for a whole day of transfers or voided entries (owner, PR 5)", () => {
    expect(dayTotalText({ inMinor: 0, outMinor: 0 }, "INR")).toBe("₹0");
    expect(dayTotalLabel({ inMinor: 0, outMinor: 0 }, "INR")).toBe("No money in or out");
  });

  it("is empty for a day still loading", () => {
    expect(dayTotalText(null, "INR")).toBe("");
    expect(dayTotalLabel(null, "INR")).toBe("");
  });

  it("says when refunds came to more than the day's spending", () => {
    expect(dayTotalText({ inMinor: 0, outMinor: -300_00 }, "INR")).toBe("+₹300 back");
    expect(dayTotalLabel({ inMinor: 0, outMinor: -300_00 }, "INR")).toBe("Refunded ₹300");
  });
});

describe("months", () => {
  const chips = [
    { month: "2026-11-01", label: "Nov" },
    { month: "2026-10-01", label: "Oct" },
  ];

  it("adds a picked month older than the chips at the end", () => {
    expect(visibleMonthChips(chips, { month: "2026-10-01" })).toEqual(chips);
    expect(visibleMonthChips(chips, { month: "2025-03-01" }).at(-1)).toEqual({ month: "2025-03-01", label: "Mar 2025" });
    expect(visibleMonthChips(chips, { month: null })).toEqual(chips);
  });

  it("offers twelve months a year, none after this one", () => {
    const months = pickerMonths(2026, "2026-11-28");
    expect(months.map((m) => m.label)).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
    expect(months.filter((m) => m.disabled).map((m) => m.month)).toEqual(["2026-12-01"]);
    expect(pickerMonths(2025, "2026-11-28").some((m) => m.disabled)).toBe(false);
  });

  it("rounds percentages in integer maths", () => {
    expect([wholePercent(7_175), wholePercent(5_249), wholePercent(-150), wholePercent(40)]).toEqual(["72%", "52%", "−2%", "0%"]);
  });
});
