import { describe, expect, it } from "vitest";
import { monthRange, yearRange } from "./dates";
import { type IncomeEntry, type IncomeSource, horizontalBarScale, incomeForPeriod, sumIncome, topGroupsWithOther } from "./income";

// The Income page's period view: grouping and totals by This month / This year / All time.

const today = "2026-02-28";
const source = (id: string, over: Partial<IncomeSource> = {}): IncomeSource => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  sourceType: "other",
  defaultAccountId: null,
  isDefault: true,
  archived: false,
  ...over,
});
let n = 0;
const entry = (over: Partial<IncomeEntry & { note: string | null }>): IncomeEntry & { note: string | null } => ({
  id: `e${++n}`,
  amountMinor: 100,
  currency: "INR",
  occurredOn: today,
  sourceId: "salary",
  accountId: "a",
  voided: false,
  note: null,
  ...over,
});

const sources = [source("salary"), source("rent"), source("freelance"), source("consulting", { isDefault: false }), source("old", { isDefault: false, archived: true })];
// Newest first, as the loader returns them.
const entries = [
  entry({ sourceId: "salary", amountMinor: 12_800_050, occurredOn: "2026-02-28", note: "February salary" }),
  entry({ sourceId: "rent", amountMinor: 3_200_000, occurredOn: "2026-02-01" }),
  entry({ sourceId: "freelance", amountMinor: 999_999, occurredOn: "2026-02-10", voided: true, note: "voided" }),
  entry({ sourceId: "salary", amountMinor: 12_800_000, occurredOn: "2026-01-31", note: "January salary" }),
  entry({ sourceId: "salary", amountMinor: 500_000, occurredOn: "2026-01-15", currency: "USD" }),
  entry({ sourceId: "rent", amountMinor: 3_200_000, occurredOn: "2025-12-31", note: "December rent" }),
  entry({ sourceId: "old", amountMinor: 700_000, occurredOn: "2024-03-01" }),
];

describe("incomeForPeriod", () => {
  it("this month: only this month's entries, month boundaries inclusive", () => {
    const p = incomeForPeriod(entries, sources, monthRange(today), "INR");
    expect(p.rows.map((r) => [r.source.id, r.amountMinor])).toEqual([
      ["salary", 12_800_050],
      ["rent", 3_200_000],
      ["consulting", 0], // added by the user: listed at zero, as before
      ["freelance", 0], // voided entries only: listed, counts as zero
    ]);
    expect(p.totalMinor).toBe(16_000_050);
    expect(p.rows.find((r) => r.source.id === "freelance")?.onlyVoided).toBe(true);
    expect(p.rows.find((r) => r.source.id === "freelance")?.note).toBeNull(); // a voided note is not shown
  });

  it("this year matches the old 'Income this year' card (sumIncome over the calendar year)", () => {
    const p = incomeForPeriod(entries, sources, yearRange(today), "INR");
    expect(p.totalMinor).toBe(sumIncome(entries, yearRange(today), "INR"));
    expect(p.totalMinor).toBe(12_800_050 + 3_200_000 + 12_800_000);
  });

  it("all time: every entry, archived sources with history included; other currencies never added", () => {
    const p = incomeForPeriod(entries, sources, null, "INR");
    expect(p.totalMinor).toBe(12_800_050 + 3_200_000 + 12_800_000 + 3_200_000 + 700_000);
    expect(p.rows.find((r) => r.source.id === "old")?.amountMinor).toBe(700_000);
  });

  it("the total is exactly the sum of the rows (integer maths, no rounding)", () => {
    for (const range of [monthRange(today), yearRange(today), null]) {
      const p = incomeForPeriod(entries, sources, range, "INR");
      expect(p.totalMinor).toBe(p.rows.reduce((s, r) => s + r.amountMinor, 0));
      expect(Number.isSafeInteger(p.totalMinor)).toBe(true);
    }
  });

  it("last received and note come from the newest non-voided entry in the period", () => {
    const year = incomeForPeriod(entries, sources, yearRange(today), "INR");
    const salary = year.rows.find((r) => r.source.id === "salary")!;
    expect(salary.lastReceivedOn).toBe("2026-02-28");
    expect(salary.note).toBe("February salary");
    const all = incomeForPeriod(entries, sources, null, "INR");
    expect(all.rows.find((r) => r.source.id === "rent")?.note).toBe("December rent"); // newest with a note
    expect(incomeForPeriod(entries, sources, monthRange(today), "INR").rows.find((r) => r.source.id === "consulting")?.lastReceivedOn).toBeNull();
  });

  it("a leap-year February includes the 29th", () => {
    const leap = [entry({ occurredOn: "2028-02-29", amountMinor: 1 }), entry({ occurredOn: "2028-03-01", amountMinor: 10 })];
    expect(incomeForPeriod(leap, sources, monthRange("2028-02-10"), "INR").totalMinor).toBe(1);
  });
});

describe("topGroupsWithOther", () => {
  const many = Array.from({ length: 9 }, (_, i) => source(`s${i}`, { isDefault: false }));
  const rows = incomeForPeriod(
    many.map((s, i) => entry({ sourceId: s.id, amountMinor: (i + 1) * 1_000 })),
    many,
    null,
    "INR",
  ).rows;

  it("top 6 keep their own colour; the rest are one 'Other' group; groups add up to the total", () => {
    const groups = topGroupsWithOther(rows);
    expect(groups).toHaveLength(7);
    expect(groups.slice(0, 6).map((g) => g.colorIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(groups[6]).toEqual({ key: "other", label: "Other", amountMinor: 1_000 + 2_000 + 3_000, colorIndex: null });
    expect(groups.reduce((s, g) => s + g.amountMinor, 0)).toBe(rows.reduce((s, r) => s + r.amountMinor, 0));
  });

  it("no Other group when six or fewer sources have income; zero rows get no bar", () => {
    const few = rows.slice(0, 3).concat({ ...rows[8]!, amountMinor: 0 });
    expect(topGroupsWithOther(few).map((g) => g.key)).toEqual(["s8", "s7", "s6"]);
  });
});

describe("horizontalBarScale", () => {
  it("positive values start at zero; the largest fills the width", () => {
    expect(horizontalBarScale([5, 10])).toEqual({ zeroBp: 0, bars: [{ startBp: 0, lengthBp: 5_000 }, { startBp: 0, lengthBp: 10_000 }] });
  });

  it("negative balances draw left of the zero line", () => {
    const { zeroBp, bars } = horizontalBarScale([-2_500, 7_500]);
    expect(zeroBp).toBe(2_500);
    expect(bars[0]).toEqual({ startBp: 0, lengthBp: 2_500 });
    expect(bars[1]).toEqual({ startBp: 2_500, lengthBp: 7_500 });
  });

  it("all zero or empty: no bars, no division by zero", () => {
    expect(horizontalBarScale([0, 0]).bars).toEqual([{ startBp: 0, lengthBp: 0 }, { startBp: 0, lengthBp: 0 }]);
    expect(horizontalBarScale([])).toEqual({ zeroBp: 0, bars: [] });
  });
});
