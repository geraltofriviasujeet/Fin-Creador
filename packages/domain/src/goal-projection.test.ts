import { describe, expect, it } from "vitest";
import { type GoalProjectionInput, goalProjection, medianMinor } from "./goal-projection";

const month = (net: number) => ({ incomeMinor: net > 0 ? net : 0, expenseMinor: net < 0 ? -net : 0 });
const six = (net: number) => Array.from({ length: 6 }, () => month(net));

const base: GoalProjectionInput = {
  today: "2026-11-06",
  targetMinor: 120_000,
  savedMinor: 0,
  targetDate: "2027-10-31",
  months: six(10_000),
  claims: [],
  otherGoals: [],
};

describe("medianMinor", () => {
  it("takes the middle value, unaffected by one large month", () => {
    expect(medianMinor([5, 1_000_000, 7])).toBe(7);
  });
  it("takes the mean of the middle two, rounded half away from zero", () => {
    expect(medianMinor([1, 2, 4, 9])).toBe(3);
    expect(medianMinor([1, 2])).toBe(2);
    expect(medianMinor([-1, -2])).toBe(-2);
  });
  it("refuses no values", () => {
    expect(() => medianMinor([])).toThrow(RangeError);
  });
});

describe("goalProjection", () => {
  it("says yes when the goal is reached by the target month", () => {
    // 12 months (Nov 2026 to Oct 2027) × 10,000 = 120,000: reached in the last month.
    const p = goalProjection(base);
    expect(p).toMatchObject({ verdict: "yes", medianNetMinor: 10_000, monthsMeasured: 6, thin: false, reachMonth: "2027-10-01", extraMonthlyMinor: null });
  });

  it("says no with the extra needed a month and the month it would be reached", () => {
    const p = goalProjection({ ...base, months: six(9_000) });
    // 12 × 9,000 = 108,000; 12,000 short over 12 months = 1,000 more a month. 14 months: Dec 2027.
    expect(p).toMatchObject({ verdict: "no", extraMonthlyMinor: 1_000, reachMonth: "2027-12-01" });
  });

  it("rounds the extra up, so it is enough", () => {
    const p = goalProjection({ ...base, targetMinor: 120_001 });
    expect(p.extraMonthlyMinor).toBe(1);
  });

  it("uses the median, not one unusual month", () => {
    const months = [month(10_000), month(10_000), month(10_000), month(900_000), month(-500_000), month(10_000)];
    expect(goalProjection({ ...base, months }).medianNetMinor).toBe(10_000);
  });

  it("does not count untracked months as zero", () => {
    const months = [month(10_000), month(10_000), month(10_000), month(10_000), month(0), month(0)];
    const p = goalProjection({ ...base, months });
    expect(p).toMatchObject({ monthsMeasured: 4, thin: true, medianNetMinor: 10_000, verdict: "yes" });
  });

  it("gives no projection with fewer than 3 tracked months", () => {
    const p = goalProjection({ ...base, months: [month(50_000), month(50_000), month(0)] });
    expect(p).toMatchObject({ verdict: "too_early", monthsMeasured: 2, medianNetMinor: null, reachMonth: null, extraMonthlyMinor: null });
    expect(p.plan.monthlyMinor).toBe(10_000);
  });

  it("takes other goals' monthly saving off for their months only", () => {
    // Another goal takes 5,000 a month for 3 months: 3 × 5,000 + 9 × 10,000 = 105,000 by Oct 2027.
    const p = goalProjection({ ...base, otherGoals: [{ monthlyMinor: 5_000, months: 3 }] });
    expect(p).toMatchObject({ verdict: "no", otherGoalsThisMonthMinor: 5_000, freeThisMonthMinor: 5_000, extraMonthlyMinor: 1_250, reachMonth: "2027-12-01" });
  });

  it("takes claims off in their month; earlier ones this month; beyond the horizon ignored", () => {
    const p = goalProjection({
      ...base,
      claims: [
        { date: "2026-09-10", amountMinor: 3_000 },
        { date: "2026-11-30", amountMinor: 2_000 },
        { date: "2027-02-05", amountMinor: 7_000 },
        { date: "2040-01-01", amountMinor: 999_999 },
      ],
    });
    expect(p).toMatchObject({ claimsThisMonthMinor: 5_000, freeThisMonthMinor: 5_000, verdict: "no" });
    // 120,000 − (120,000 − 12,000) = 12,000 short over 12 months.
    expect(p.extraMonthlyMinor).toBe(1_000);
  });

  it("lets a month with less than nothing free reduce the running total", () => {
    const p = goalProjection({ ...base, targetDate: "2026-12-31", targetMinor: 15_000, claims: [{ date: "2026-12-01", amountMinor: 20_000 }] });
    // Nov: 10,000; Dec: −10,000 → 0. Reached later: Jan 10,000, Feb 20,000.
    expect(p).toMatchObject({ verdict: "no", reachMonth: "2027-02-01", extraMonthlyMinor: 7_500 });
  });

  it("says no and never within 10 years when nothing is free", () => {
    const p = goalProjection({ ...base, months: six(-1_000) });
    expect(p).toMatchObject({ verdict: "no", reachMonth: null, medianNetMinor: -1_000, extraMonthlyMinor: 11_000 });
  });

  it("without a target date: yes and when, or no within 10 years", () => {
    const yes = goalProjection({ ...base, targetDate: null, targetMinor: 50_000 });
    expect(yes).toMatchObject({ verdict: "yes", reachMonth: "2027-03-01", extraMonthlyMinor: null });
    expect(yes.plan.basis).toBe("assumed_months");
    const no = goalProjection({ ...base, targetDate: null, targetMinor: 1_300_000 });
    // 120 × 10,000 = 1,200,000: 100,000 short over 120 months.
    expect(no).toMatchObject({ verdict: "no", reachMonth: null, extraMonthlyMinor: 834 });
  });

  it("projects to a target month beyond 10 years", () => {
    const p = goalProjection({ ...base, targetDate: "2041-10-31", targetMinor: 1_500_000 });
    expect(p).toMatchObject({ verdict: "yes", reachMonth: "2039-04-01" });
  });

  it("says no when the target month has passed, with the month it would be reached", () => {
    const p = goalProjection({ ...base, targetDate: "2026-08-31", targetMinor: 30_000, savedMinor: 5_000 });
    expect(p.plan).toMatchObject({ basis: "past_due", remainingMinor: 25_000 });
    expect(p).toMatchObject({ verdict: "no", reachMonth: "2027-01-01", extraMonthlyMinor: null });
  });

  it("says no for a passed date even with too few months, without projecting", () => {
    const p = goalProjection({ ...base, targetDate: "2026-08-31", months: [] });
    expect(p).toMatchObject({ verdict: "no", reachMonth: null, medianNetMinor: null });
  });

  it("says yes when the goal is already saved", () => {
    const p = goalProjection({ ...base, savedMinor: 120_000, months: [] });
    expect(p).toMatchObject({ verdict: "yes", reachMonth: null });
    expect(p.plan.basis).toBe("reached");
  });

  it("refuses a negative claim", () => {
    expect(() => goalProjection({ ...base, claims: [{ date: "2026-12-01", amountMinor: -1 }] })).toThrow(RangeError);
  });
});
