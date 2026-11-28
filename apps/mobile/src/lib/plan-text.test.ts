import { budgetStatus, savingPlan } from "@fin-creador/domain";
import { describe, expect, it } from "vitest";
import {
  BUDGET_MONTH_COUNT,
  SET_BUDGET_AGAIN,
  budgetBadge,
  budgetBarLabel,
  budgetBarTone,
  goalBehindText,
  goalPaceTag,
  goalSavingText,
  goalsSummaryText,
  savedPercent,
  budgetMonthHeading,
  budgetMonthOptions,
  budgetsSummaryText,
  leftWord,
  usedPercent,
} from "./plan-text";

describe("budgetBadge", () => {
  it("follows the domain's levels: near limit from 80%, over at 100%", () => {
    expect(budgetBadge(budgetStatus(4_799_99, 6_000_00))).toBeNull();
    expect(budgetBadge(budgetStatus(4_800_00, 6_000_00))).toEqual({ label: "Near limit", tone: "caution" });
    expect(budgetBadge(budgetStatus(5_999_99, 6_000_00))).toEqual({ label: "Near limit", tone: "caution" });
    expect(budgetBadge(budgetStatus(6_000_00, 6_000_00))).toEqual({ label: "Over budget", tone: "danger" });
  });

  it("asks to set a budget in another currency again", () => {
    expect(budgetBadge(null)).toEqual({ label: SET_BUDGET_AGAIN, tone: "neutral" });
  });
});

describe("usedPercent and budgetBarLabel", () => {
  it("rounds down, so 99.9% does not read as 100%", () => {
    expect(usedPercent(budgetStatus(5_994_00, 6_000_00))).toBe("99%");
    expect(usedPercent(budgetStatus(9_000_00, 6_000_00))).toBe("150%");
  });

  it("says the level in words", () => {
    expect(budgetBarLabel("Food", budgetStatus(5_100_00, 6_000_00))).toBe("Food: 85% used, near limit");
    expect(budgetBarLabel("Shopping", budgetStatus(3_600_00, 3_000_00))).toBe("Shopping: 120% used, over budget");
    expect(budgetBarLabel("Travel", budgetStatus(500_00, 4_000_00))).toBe("Travel: 12% used");
  });
});

describe("leftWord", () => {
  it("is left until spending passes the budget", () => {
    expect(leftWord(budgetStatus(6_000_00, 6_000_00))).toBe("left");
    expect(leftWord(budgetStatus(6_000_01, 6_000_00))).toBe("over");
  });
});

describe("budgetsSummaryText", () => {
  it("counts each level, or says all is within budget", () => {
    expect(budgetsSummaryText({ overCount: 1, warningCount: 2, resetCount: 0 })).toBe("1 over budget · 2 near limit");
    expect(budgetsSummaryText({ overCount: 0, warningCount: 0, resetCount: 1 })).toBe("1 to set again");
    expect(budgetsSummaryText({ overCount: 0, warningCount: 0, resetCount: 0 })).toBe("All within budget");
  });
});

describe("budgetMonthOptions", () => {
  it("lists this month and the 23 after it, across the year end", () => {
    const options = budgetMonthOptions("2026-11-28");
    expect(options).toHaveLength(BUDGET_MONTH_COUNT);
    expect(options[0]).toEqual({ value: "2026-11", label: "Nov 2026", start: "2026-11-01" });
    expect(options[2]).toEqual({ value: "2027-01", label: "Jan 2027", start: "2027-01-01" });
    expect(options.at(-1)).toEqual({ value: "2028-10", label: "Oct 2028", start: "2028-10-01" });
  });

  it("starts at the month of a leap day", () => {
    expect(budgetMonthOptions("2028-02-29")[0]?.value).toBe("2028-02");
  });
});

describe("budgetMonthHeading", () => {
  it("names this month as such", () => {
    expect(budgetMonthHeading("2026-11-01", "2026-11-28")).toBe("This month · Nov 2026");
    expect(budgetMonthHeading("2026-12-01", "2026-11-28")).toBe("Dec 2026");
  });
});

describe("budgetBarTone", () => {
  it("is red only once over budget; amber from 80% to under 100%", () => {
    expect(budgetBarTone(budgetStatus(4_799_99, 6_000_00))).toBe("ok");
    expect(budgetBarTone(budgetStatus(4_800_00, 6_000_00))).toBe("caution");
    expect(budgetBarTone(budgetStatus(5_999_99, 6_000_00))).toBe("caution");
    expect(budgetBarTone(budgetStatus(6_000_00, 6_000_00))).toBe("over");
  });
});

describe("goal words", () => {
  const goal = (over: { targetDate?: string | null; savedMinor?: number; targetMinor?: number } = {}) => {
    const g = { currency: "INR", targetMinor: 40_000_00, savedMinor: 8_000_00, targetDate: "2027-04-15" as string | null, ...over };
    return { goal: g, plan: savingPlan({ targetMinor: g.targetMinor, savedMinor: g.savedMinor, targetDate: g.targetDate, today: "2026-11-28" }) };
  };

  it("says what to save a month, as the web does", () => {
    expect(goalSavingText(goal())).toBe("Save ₹5,333.33 a month for 6 months (by 15 Apr 2027)");
    expect(goalSavingText(goal({ targetDate: null }))).toBe("Save ₹2,666.67 a month, assuming 12 months (no target date)");
    expect(goalSavingText(goal({ savedMinor: 40_000_00 }))).toBe("Saved in full");
    expect(goalSavingText(goal({ targetDate: "2026-10-31" }))).toBe("Target date 31 Oct 2026 has passed: ₹32,000 still to save");
  });

  it("names the pace in words, and how far behind", () => {
    const behind = { status: "behind" as const, expectedMinor: 40_000_00, shortMinor: 30_000_00 };
    const onTrack = { status: "on_track" as const, expectedMinor: 0, shortMinor: 0 };
    expect(goalPaceTag(behind)).toEqual({ label: "Behind", tone: "caution" });
    expect(goalPaceTag(onTrack)).toEqual({ label: "On track", tone: "neutral" });
    expect(goalPaceTag(null)).toBeNull();
    expect(goalPaceTag({ status: "reached", expectedMinor: 1, shortMinor: 0 })).toBeNull();
    expect(goalBehindText(behind, "INR")).toBe("₹30,000 behind an even pace since you added it");
    expect(goalBehindText(onTrack, "INR")).toBeNull();
    expect(goalsSummaryText([behind, onTrack, null])).toBe("1 behind · 1 on track");
    expect(goalsSummaryText([null])).toBeNull();
  });

  it("rounds the saved share down", () => {
    expect(savedPercent(9_960)).toBe("99%");
    expect(savedPercent(2_000)).toBe("20%");
  });
});
