import { describe, expect, it } from "vitest";
import { goalProjection } from "./goal-projection";
import {
  TRIP_RUN_MAX_DAYS,
  type TripComparable,
  daysInclusive,
  findTravelRuns,
  largestThatFits,
  scaleComparable,
  tripEstimate,
} from "./trip-estimate";

const costs = { transport: 20_000, stay: 30_000, food: 10_000, activities: 0, visaInsurance: 4_000, shopping: 0, buffer: 0 };
const goal: TripComparable = { kind: "goal", name: "Goa", scope: "domestic", days: 4, travellers: 2, costs };
const run = (amountMinor: number, scope: "domestic" | "international" = "domestic"): TripComparable => ({
  kind: "run",
  from: "2026-03-03",
  to: "2026-03-07",
  scope,
  days: 5,
  travellers: 2,
  amountMinor,
});

describe("findTravelRuns", () => {
  it("groups entries no more than 3 days apart, newest run first", () => {
    expect(findTravelRuns(["2026-03-07", "2026-03-03", "2026-03-05", "2026-03-05", "2026-06-01", "2026-06-04"])).toEqual([
      { from: "2026-06-01", to: "2026-06-04", days: 4 },
      { from: "2026-03-03", to: "2026-03-07", days: 5 },
    ]);
  });
  it("starts a new run after a gap of 4 days", () => {
    expect(findTravelRuns(["2026-03-01", "2026-03-05"])).toEqual([
      { from: "2026-03-05", to: "2026-03-05", days: 1 },
      { from: "2026-03-01", to: "2026-03-01", days: 1 },
    ]);
  });
  it("crosses month and leap-day boundaries", () => {
    expect(findTravelRuns(["2028-02-27", "2028-03-01"])).toEqual([{ from: "2028-02-27", to: "2028-03-01", days: 4 }]);
  });
  it("leaves out runs longer than the limit (regular travel spending)", () => {
    const daily = Array.from({ length: TRIP_RUN_MAX_DAYS + 1 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    expect(findTravelRuns(daily)).toEqual([]);
    expect(findTravelRuns(daily.slice(0, TRIP_RUN_MAX_DAYS))).toHaveLength(1);
  });
  it("finds nothing without entries", () => {
    expect(findTravelRuns([])).toEqual([]);
  });
});

describe("daysInclusive", () => {
  it("counts both ends", () => {
    expect(daysInclusive("2026-03-03", "2026-03-07")).toBe(5);
    expect(daysInclusive("2026-12-31", "2027-01-01")).toBe(2);
  });
});

describe("scaleComparable", () => {
  it("scales a run per traveller-day", () => {
    // 50,000 for 2 travellers over 5 days = 5,000 a traveller-day; 3 travellers, 4 days.
    expect(scaleComparable(run(50_000), { days: 4, travellers: 3 })).toBe(60_000);
  });
  it("scales a goal's transport and visa per traveller, the rest per traveller-day", () => {
    // Per traveller: 24,000 / 2 = 12,000. Per traveller-day: 40,000 / 8 = 5,000.
    expect(scaleComparable(goal, { days: 6, travellers: 1 })).toBe(12_000 + 30_000);
    expect(scaleComparable(goal, { days: 4, travellers: 2 })).toBe(64_000);
  });
  it("rounds half away from zero", () => {
    expect(scaleComparable(run(5), { days: 1, travellers: 1 })).toBe(1);
    expect(scaleComparable(run(15), { days: 1, travellers: 1 })).toBe(2);
  });
  it("refuses a zero size", () => {
    expect(() => scaleComparable(run(1), { days: 0, travellers: 1 })).toThrow(RangeError);
  });
});

describe("tripEstimate", () => {
  it("takes the median of what each same-scope comparable scales to", () => {
    const e = tripEstimate([run(50_000), run(100_000), goal, run(1, "international")], "domestic", { days: 5, travellers: 2 });
    // run 50,000; run 100,000; goal 24,000 + 50,000 = 74,000.
    expect(e?.scaled.map((s) => s.minor)).toEqual([50_000, 100_000, 74_000]);
    expect(e?.estimateMinor).toBe(74_000);
  });
  it("gives no estimate when nothing has the trip's scope", () => {
    expect(tripEstimate([run(50_000), goal], "international", { days: 5, travellers: 2 })).toBeNull();
    expect(tripEstimate([], "domestic", { days: 5, travellers: 2 })).toBeNull();
  });
});

describe("largestThatFits", () => {
  it("finds the most days or travellers the money covers", () => {
    // 5,000 a traveller-day.
    expect(largestThatFits([run(50_000)], "domestic", { days: 5, travellers: 2 }, "days", 365, 32_000)).toBe(3);
    expect(largestThatFits([run(50_000)], "domestic", { days: 5, travellers: 2 }, "travellers", 100, 52_000)).toBe(2);
  });
  it("is null when even one doesn't fit, or without comparables", () => {
    expect(largestThatFits([run(50_000)], "domestic", { days: 5, travellers: 2 }, "days", 365, 9_999)).toBeNull();
    expect(largestThatFits([], "domestic", { days: 5, travellers: 2 }, "days", 365, 1_000_000)).toBeNull();
  });
});

describe("goalProjection: available by the target month", () => {
  const input = {
    today: "2026-11-06",
    targetMinor: 120_000,
    savedMinor: 0,
    months: Array.from({ length: 6 }, () => ({ incomeMinor: 10_000, expenseMinor: 0 })),
    claims: [],
    otherGoals: [],
  };
  it("adds up free money from this month to the target month, both counted", () => {
    expect(goalProjection({ ...input, targetDate: "2027-01-15" }).availableByTargetMinor).toBe(30_000);
  });
  it("is null without a target date", () => {
    expect(goalProjection({ ...input, targetDate: null }).availableByTargetMinor).toBeNull();
  });
});
