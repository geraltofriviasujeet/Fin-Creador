import { describe, expect, it } from "vitest";
import { borrowingDueProgress, borrowingSchedule } from "./borrowing";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("borrowingSchedule", () => {
  it("once: one item on the return date with all the extra as interest", () => {
    expect(borrowingSchedule({ totalMinor: 110000, borrowedMinor: 100000, returnOn: "2027-03-15", returnPlan: "once", instalmentCount: null })).toEqual([
      { seq: 0, dueDate: "2027-03-15", amountMinor: 110000, interestMinor: 10000 },
    ]);
  });

  it("instalments: floor amounts, the last takes the remainder; interest adds up to the extra", () => {
    const s = borrowingSchedule({ totalMinor: 100000, borrowedMinor: 90000, returnOn: "2027-01-10", returnPlan: "instalments", instalmentCount: 3 });
    expect(s.map((i) => i.amountMinor)).toEqual([33333, 33333, 33334]);
    expect(s.map((i) => i.interestMinor)).toEqual([3333, 3333, 3334]);
    expect(s.map((i) => i.seq)).toEqual([1, 2, 3]);
  });

  it("dates: the return day clamped to the end of each month, not chained", () => {
    const s = borrowingSchedule({ totalMinor: 400, borrowedMinor: 400, returnOn: "2027-01-31", returnPlan: "instalments", instalmentCount: 4 });
    expect(s.map((i) => i.dueDate)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    const leap = borrowingSchedule({ totalMinor: 200, borrowedMinor: 200, returnOn: "2028-01-30", returnPlan: "instalments", instalmentCount: 2 });
    expect(leap.map((i) => i.dueDate)).toEqual(["2028-01-30", "2028-02-29"]);
    const year = borrowingSchedule({ totalMinor: 200, borrowedMinor: 200, returnOn: "2027-12-31", returnPlan: "instalments", instalmentCount: 2 });
    expect(year.map((i) => i.dueDate)).toEqual(["2027-12-31", "2028-01-31"]);
  });

  it("interest never exceeds an instalment, even when the extra is most of the total", () => {
    const s = borrowingSchedule({ totalMinor: 12, borrowedMinor: 1, returnOn: "2027-01-01", returnPlan: "instalments", instalmentCount: 3 });
    expect(s.map((i) => i.interestMinor)).toEqual([3, 4, 4]);
    for (const i of s) expect(i.interestMinor).toBeLessThanOrEqual(i.amountMinor);
    const cases: [number, number, number][] = [[1_000_003, 7, 7], [10_000_000_000_000, 1, 60], [61, 60, 60], [999, 998, 13]];
    for (const [total, borrowed, n] of cases) {
      const x = borrowingSchedule({ totalMinor: total, borrowedMinor: borrowed, returnOn: "2027-05-31", returnPlan: "instalments", instalmentCount: n });
      expect(sum(x.map((i) => i.amountMinor))).toBe(total);
      expect(sum(x.map((i) => i.interestMinor))).toBe(total - borrowed);
      for (const i of x) expect(i.interestMinor).toBeGreaterThanOrEqual(0);
      for (const i of x) expect(i.interestMinor).toBeLessThanOrEqual(i.amountMinor);
    }
  });

  it("refuses a bad plan", () => {
    const base = { totalMinor: 100, borrowedMinor: 100, returnOn: "2027-01-01", returnPlan: "instalments" as const };
    expect(() => borrowingSchedule({ ...base, instalmentCount: 1 })).toThrow(RangeError);
    expect(() => borrowingSchedule({ ...base, instalmentCount: 61 })).toThrow(RangeError);
    expect(() => borrowingSchedule({ ...base, totalMinor: 99, instalmentCount: 2 })).toThrow(RangeError);
    expect(() => borrowingSchedule({ ...base, totalMinor: 3, borrowedMinor: 3, instalmentCount: 4 })).toThrow(RangeError);
  });
});

describe("borrowingDueProgress", () => {
  const items = [
    { seq: 1, amountDueMinor: 33333, interestMinor: 3333 },
    { seq: 2, amountDueMinor: 33333, interestMinor: 3333 },
    { seq: 3, amountDueMinor: 33334, interestMinor: 3334 },
  ];

  it("covers items in seq order; a part-covered item stays pending, interest first", () => {
    expect(borrowingDueProgress(items, 43333, 60000)).toEqual([
      { seq: 1, status: "paid", remainingMinor: 0, remainingInterestMinor: 0, remainingPrincipalMinor: 0 },
      { seq: 2, status: "pending", remainingMinor: 23333, remainingInterestMinor: 0, remainingPrincipalMinor: 23333 },
      { seq: 3, status: "pending", remainingMinor: 33334, remainingInterestMinor: 3334, remainingPrincipalMinor: 30000 },
    ]);
  });

  it("all paid once nothing is owed; the principal left is capped at what is owed", () => {
    expect(borrowingDueProgress(items, 90000, 0).every((p) => p.status === "paid" && p.remainingMinor === 0)).toBe(true);
    expect(borrowingDueProgress(items, 0, 1000)[0]).toMatchObject({ remainingMinor: 33333, remainingInterestMinor: 3333, remainingPrincipalMinor: 1000 });
  });
});
