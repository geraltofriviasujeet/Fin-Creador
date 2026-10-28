import { describe, expect, it } from "vitest";
import {
  bucketSizeFor,
  changeBasisPoints,
  comparisonFor,
  dashboardRange,
  daysBetween,
  fillBuckets,
  partialBucket,
  pointsChange,
  rangeLength,
  topCategories,
  weekRange,
} from "./dashboard";

describe("weekRange", () => {
  it("runs Monday to Sunday", () => {
    expect(weekRange("2026-10-26")).toEqual({ start: "2026-10-26", end: "2026-11-01" }); // Monday
    expect(weekRange("2026-11-01")).toEqual({ start: "2026-10-26", end: "2026-11-01" }); // Sunday
  });
  it("crosses month and year ends", () => {
    expect(weekRange("2026-01-01")).toEqual({ start: "2025-12-29", end: "2026-01-04" });
    expect(weekRange("2024-03-01")).toEqual({ start: "2024-02-26", end: "2024-03-03" });
  });
});

describe("dashboardRange", () => {
  it("returns the whole week, month or year containing today", () => {
    expect(dashboardRange("week", "2026-10-28")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(dashboardRange("month", "2024-02-10")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(dashboardRange("year", "2026-10-28")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });
  it("orders a custom range and falls back to the month without one", () => {
    expect(dashboardRange("custom", "2026-10-28", { start: "2026-10-10", end: "2026-09-01" })).toEqual({
      start: "2026-09-01",
      end: "2026-10-10",
    });
    expect(dashboardRange("custom", "2026-10-28")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  });
});

describe("comparisonFor", () => {
  it("compares the days so far of a month with the same days last month", () => {
    expect(comparisonFor("month", dashboardRange("month", "2026-10-26"), "2026-10-26")).toEqual({
      current: { start: "2026-10-01", end: "2026-10-26" },
      previous: { start: "2026-09-01", end: "2026-09-26" },
      label: "vs same days last month",
    });
  });
  it("clamps to the end of a shorter previous month, leap years included", () => {
    expect(comparisonFor("month", dashboardRange("month", "2026-03-31"), "2026-03-31")?.previous).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
    expect(comparisonFor("month", dashboardRange("month", "2024-03-31"), "2024-03-31")?.previous).toEqual({
      start: "2024-02-01",
      end: "2024-02-29",
    });
  });
  it("compares January with December of the previous year", () => {
    expect(comparisonFor("month", dashboardRange("month", "2026-01-15"), "2026-01-15")?.previous).toEqual({
      start: "2025-12-01",
      end: "2025-12-15",
    });
  });
  it("compares a year so far with the same days last year (29 February → 28 February)", () => {
    expect(comparisonFor("year", dashboardRange("year", "2024-02-29"), "2024-02-29")).toEqual({
      current: { start: "2024-01-01", end: "2024-02-29" },
      previous: { start: "2023-01-01", end: "2023-02-28" },
      label: "vs same days last year",
    });
  });
  it("compares a week so far with the same weekdays last week", () => {
    expect(comparisonFor("week", dashboardRange("week", "2026-01-01"), "2026-01-01")).toEqual({
      current: { start: "2025-12-29", end: "2026-01-01" },
      previous: { start: "2025-12-22", end: "2025-12-25" },
      label: "vs same days last week",
    });
  });
  it("compares a custom range with the same number of days just before it", () => {
    expect(comparisonFor("custom", { start: "2026-03-01", end: "2026-03-10" }, "2026-10-26")).toEqual({
      current: { start: "2026-03-01", end: "2026-03-10" },
      previous: { start: "2026-02-19", end: "2026-02-28" },
      label: "vs previous 10 days",
    });
    expect(comparisonFor("custom", { start: "2026-03-01", end: "2026-03-01" }, "2026-10-26")?.label).toBe(
      "vs previous 1 day",
    );
  });
  it("stops a custom range at today and has nothing to compare for a future range", () => {
    expect(comparisonFor("custom", { start: "2026-10-20", end: "2026-11-30" }, "2026-10-26")?.current).toEqual({
      start: "2026-10-20",
      end: "2026-10-26",
    });
    expect(comparisonFor("custom", { start: "2026-11-01", end: "2026-11-30" }, "2026-10-26")).toBeNull();
  });
});

describe("changeBasisPoints and pointsChange", () => {
  it("gives the change in basis points", () => {
    expect(changeBasisPoints(11_250, 10_000)).toBe(1_250);
    expect(changeBasisPoints(5_000, 10_000)).toBe(-5_000);
    expect(changeBasisPoints(1, 3)).toBe(-6_667);
  });
  it("is null (shown as —) when there is nothing to compare with", () => {
    expect(changeBasisPoints(500, 0)).toBeNull();
    expect(changeBasisPoints(0, 0)).toBeNull();
  });
  it("measures a negative previous value by its size", () => {
    expect(changeBasisPoints(-500, -1_000)).toBe(5_000);
  });
  it("subtracts rates, null when either is missing", () => {
    expect(pointsChange(5_210, 4_830)).toBe(380);
    expect(pointsChange(null, 4_830)).toBeNull();
    expect(pointsChange(5_210, null)).toBeNull();
  });
});

describe("buckets", () => {
  it("counts days with both ends included", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(rangeLength({ start: "2026-01-01", end: "2026-12-31" })).toBe(365);
  });
  it("charts up to 62 days by day and longer ranges by month", () => {
    expect(bucketSizeFor({ start: "2026-01-01", end: "2026-03-03" })).toBe("day"); // 62 days
    expect(bucketSizeFor({ start: "2026-01-01", end: "2026-03-04" })).toBe("month"); // 63 days
  });
  it("fills every day with zeros where nothing was recorded", () => {
    const filled = fillBuckets({ start: "2024-02-28", end: "2024-03-01" }, [
      { start: "2024-02-29", incomeMinor: 0, expenseMinor: 700 },
    ]);
    expect(filled).toEqual([
      { start: "2024-02-28", incomeMinor: 0, expenseMinor: 0 },
      { start: "2024-02-29", incomeMinor: 0, expenseMinor: 700 },
      { start: "2024-03-01", incomeMinor: 0, expenseMinor: 0 },
    ]);
  });
  it("fills months across a year end, starting at the first month of the range", () => {
    const filled = fillBuckets({ start: "2025-11-15", end: "2026-02-10" }, [
      { start: "2026-01-01", incomeMinor: 100, expenseMinor: 0 },
    ]);
    expect(filled.map((b) => b.start)).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
    expect(filled[2]).toEqual({ start: "2026-01-01", incomeMinor: 100, expenseMinor: 0 });
  });
});

describe("partialBucket", () => {
  const range = { start: "2025-11-15", end: "2026-02-10" };
  it("gives the in-range part of a partial first or last month", () => {
    expect(partialBucket("2025-11-01", range)).toEqual({ start: "2025-11-15", end: "2025-11-30" });
    expect(partialBucket("2026-02-01", range)).toEqual({ start: "2026-02-01", end: "2026-02-10" });
  });
  it("is null for whole months and day buckets", () => {
    expect(partialBucket("2025-12-01", range)).toBeNull();
    expect(partialBucket("2026-10-01", { start: "2026-01-01", end: "2026-12-31" })).toBeNull();
    expect(partialBucket("2026-10-05", { start: "2026-10-01", end: "2026-10-31" })).toBeNull();
  });
  it("treats a short range as months when asked (Reports: one month, so far)", () => {
    expect(partialBucket("2026-10-01", { start: "2026-10-01", end: "2026-10-28" }, "month")).toEqual({ start: "2026-10-01", end: "2026-10-28" });
    expect(partialBucket("2026-09-01", { start: "2026-09-01", end: "2026-10-28" }, "month")).toBeNull();
  });
});

describe("topCategories", () => {
  const rows = [
    { categoryId: "food", expenseMinor: 500 },
    { categoryId: "rent", expenseMinor: 2_000 },
    { categoryId: "fuel", expenseMinor: 300 },
    { categoryId: "gifts", expenseMinor: 300 },
    { categoryId: "health", expenseMinor: 100 },
    { categoryId: "books", expenseMinor: 50 },
    { categoryId: "pets", expenseMinor: 25 },
    { categoryId: "zero", expenseMinor: 0 },
  ];
  it("keeps the top five and adds the rest up as Everything else", () => {
    expect(topCategories(rows)).toEqual([
      { categoryId: "rent", expenseMinor: 2_000 },
      { categoryId: "food", expenseMinor: 500 },
      { categoryId: "fuel", expenseMinor: 300 },
      { categoryId: "gifts", expenseMinor: 300 },
      { categoryId: "health", expenseMinor: 100 },
      { categoryId: null, expenseMinor: 75 },
    ]);
  });
  it("has no Everything else row when five or fewer categories have spending", () => {
    expect(topCategories(rows.slice(0, 5)).every((r) => r.categoryId !== null)).toBe(true);
    expect(topCategories([])).toEqual([]);
  });
});
