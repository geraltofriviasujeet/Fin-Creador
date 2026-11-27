import { describe, expect, it } from "vitest";
import { type SpendEntry, type SpendLimitRule, everydaySpendingMinor, limitExceedsMoneyAfterBills, spendLimitPeriod, spendLimitToday } from "./spend-limit";

// Demo figures only. ₹1 = 100 paise.
const rs = (rupees: number) => Math.round(rupees * 100);

const limit = (period: SpendLimitRule["period"], rupees: number, startsOn: string, periodDays?: number): SpendLimitRule => ({
  amountMinor: rs(rupees),
  period,
  periodDays: periodDays ?? (period === "day" ? 1 : period === "week" ? 7 : null),
  startsOn,
});

const spend = (occurredOn: string, rupees: number, over: Partial<SpendEntry> = {}): SpendEntry => ({
  type: "expense",
  amountMinor: rs(rupees),
  currency: "INR",
  occurredOn,
  voided: false,
  recurringRuleId: null,
  paymentId: null,
  ...over,
});

describe("spendLimitPeriod", () => {
  it("a day is just today", () => {
    expect(spendLimitPeriod(limit("day", 1_000, "2026-11-01"), "2026-11-27")).toEqual({ start: "2026-11-27", end: "2026-11-27" });
  });

  it("weeks run in sevens from the day it was set", () => {
    const week = limit("week", 7_000, "2026-11-20"); // a Friday
    expect(spendLimitPeriod(week, "2026-11-20")).toEqual({ start: "2026-11-20", end: "2026-11-26" });
    expect(spendLimitPeriod(week, "2026-11-26")).toEqual({ start: "2026-11-20", end: "2026-11-26" });
    expect(spendLimitPeriod(week, "2026-11-27")).toEqual({ start: "2026-11-27", end: "2026-12-03" });
    // Across the year's end.
    expect(spendLimitPeriod(week, "2026-12-31")).toEqual({ start: "2026-12-25", end: "2026-12-31" });
    expect(spendLimitPeriod(week, "2027-01-01")).toEqual({ start: "2027-01-01", end: "2027-01-07" });
  });

  it("custom periods run in their own count of days", () => {
    const ten = limit("custom", 5_000, "2026-11-20", 10);
    expect(spendLimitPeriod(ten, "2026-11-29")).toEqual({ start: "2026-11-20", end: "2026-11-29" });
    expect(spendLimitPeriod(ten, "2026-11-30")).toEqual({ start: "2026-11-30", end: "2026-12-09" });
  });

  it("months start on the same day each month", () => {
    const month = limit("month", 30_000, "2026-11-10");
    expect(spendLimitPeriod(month, "2026-11-27")).toEqual({ start: "2026-11-10", end: "2026-12-09" });
    expect(spendLimitPeriod(month, "2026-12-10")).toEqual({ start: "2026-12-10", end: "2027-01-09" });
  });

  it("set on the 31st: the month's last day in shorter months, including 29 February", () => {
    const month = limit("month", 30_000, "2027-01-31");
    expect(spendLimitPeriod(month, "2027-02-15")).toEqual({ start: "2027-01-31", end: "2027-02-27" });
    expect(spendLimitPeriod(month, "2027-02-28")).toEqual({ start: "2027-02-28", end: "2027-03-30" });
    expect(spendLimitPeriod(month, "2027-03-31")).toEqual({ start: "2027-03-31", end: "2027-04-29" });
    const leap = limit("month", 30_000, "2028-01-31");
    expect(spendLimitPeriod(leap, "2028-02-29")).toEqual({ start: "2028-02-29", end: "2028-03-30" });
  });

  it("a today before starts_on (time zone changed) starts the period today", () => {
    expect(spendLimitPeriod(limit("week", 7_000, "2026-11-28"), "2026-11-27")).toEqual({ start: "2026-11-27", end: "2026-12-03" });
  });

  it("refuses a period that doesn't match its day count", () => {
    expect(() => spendLimitPeriod({ ...limit("week", 7_000, "2026-11-20"), periodDays: 6 }, "2026-11-27")).toThrow(RangeError);
    expect(() => spendLimitPeriod(limit("custom", 7_000, "2026-11-20", 1), "2026-11-27")).toThrow(RangeError);
    expect(() => spendLimitPeriod({ ...limit("day", 1_000, "2026-11-20"), amountMinor: 0 }, "2026-11-27")).toThrow(RangeError);
  });
});

describe("everydaySpendingMinor", () => {
  const day = { start: "2026-11-27", end: "2026-11-27" };

  it("expenses minus refunds; bills, payments, transfers, income, voided and other currencies left out", () => {
    const entries = [
      spend("2026-11-27", 1_200),
      spend("2026-11-27", 300, { type: "refund" }),
      spend("2026-11-27", 2_400, { recurringRuleId: "electricity" }),
      spend("2026-11-27", 1_500, { paymentId: "emi-interest" }),
      spend("2026-11-27", 5_000, { type: "transfer" }),
      spend("2026-11-27", 85_000, { type: "income" }),
      spend("2026-11-27", 999, { voided: true }),
      spend("2026-11-27", 50, { currency: "USD" }),
      spend("2026-11-26", 700),
    ];
    expect(everydaySpendingMinor(entries, day, "INR")).toBe(rs(900));
  });

  it("never below zero when refunds are bigger", () => {
    expect(everydaySpendingMinor([spend("2026-11-27", 100), spend("2026-11-27", 400, { type: "refund" })], day, "INR")).toBe(0);
  });
});

describe("spendLimitToday", () => {
  it("₹7,000 a week, set today: ₹1,000 a day; ₹1,200 spent today → ₹200 over", () => {
    const r = spendLimitToday(limit("week", 7_000, "2026-11-27"), [spend("2026-11-27", 1_200)], "2026-11-27", "INR");
    expect(r.daysLeft).toBe(7);
    expect(r.spentEarlierMinor).toBe(0);
    expect(r.dailyMinor).toBe(rs(1_000));
    expect(r.spentTodayMinor).toBe(rs(1_200));
    expect(r.leftTodayMinor).toBe(-rs(200));
  });

  it("rolling: what was spent earlier in the period comes off, shared over the days left", () => {
    // Week of 20–26 Nov; ₹4,000 spent before today (24th), 3 days left: (₹7,000 − ₹4,000) ÷ 3.
    const entries = [spend("2026-11-19", 9_000), spend("2026-11-20", 2_500), spend("2026-11-22", 1_500), spend("2026-11-24", 400)];
    const r = spendLimitToday(limit("week", 7_000, "2026-11-20"), entries, "2026-11-24", "INR");
    expect(r.period).toEqual({ start: "2026-11-20", end: "2026-11-26" });
    expect(r.daysLeft).toBe(3);
    expect(r.spentEarlierMinor).toBe(rs(4_000));
    expect(r.dailyMinor).toBe(rs(1_000));
    expect(r.leftTodayMinor).toBe(rs(600));
  });

  it("rounds down to a paisa: ₹5,000 over 10 days less ₹1 → ₹555.44 a day for 9 days", () => {
    const r = spendLimitToday(limit("custom", 5_000, "2026-11-20", 10), [spend("2026-11-20", 1)], "2026-11-21", "INR");
    expect(r.daysLeft).toBe(9);
    expect(r.dailyMinor).toBe(55_544); // 4,99,900 ÷ 9 = 55,544.4
  });

  it("the period's amount used up earlier: ₹0 a day, and today's spending is over", () => {
    const r = spendLimitToday(limit("month", 30_000, "2026-11-10"), [spend("2026-11-12", 31_000), spend("2026-11-27", 100)], "2026-11-27", "INR");
    expect(r.daysLeft).toBe(13);
    expect(r.dailyMinor).toBe(0);
    expect(r.leftTodayMinor).toBe(-rs(100));
  });

  it("a day limit ignores yesterday", () => {
    const r = spendLimitToday(limit("day", 1_000, "2026-11-01"), [spend("2026-11-26", 5_000)], "2026-11-27", "INR");
    expect(r.dailyMinor).toBe(rs(1_000));
    expect(r.leftTodayMinor).toBe(rs(1_000));
  });
});

describe("limitExceedsMoneyAfterBills", () => {
  it("only when the daily limit for every day left is more than money left after bills", () => {
    expect(limitExceedsMoneyAfterBills(rs(2_000), 7, rs(12_983))).toBe(true);
    expect(limitExceedsMoneyAfterBills(rs(1_854), 7, rs(12_983))).toBe(false);
    expect(limitExceedsMoneyAfterBills(rs(1_000), 7, rs(7_000))).toBe(false);
    expect(limitExceedsMoneyAfterBills(rs(1), 1, -rs(100))).toBe(true);
  });
});
