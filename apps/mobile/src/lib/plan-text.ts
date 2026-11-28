import { type GoalItem, type PlanBudgets, fullDate, monthLabel, money } from "@fin-creador/api";
import { type BudgetStatus, type GoalPace, type IsoDate, addDays, monthRange } from "@fin-creador/domain";

// Words for the phone's Plan tab and Budgets screen (Sprint 13c). Same wording as the web Goals
// page (apps/web/components/goals/display.tsx): "Over budget" at 100%, "Near limit" from the
// domain's 80% (budgetStatus), "Set your budget again" for a budget in another currency. No Intl
// (Hermes): months come from monthLabel, percentages are whole numbers worked out here.

export const SET_BUDGET_AGAIN = "Set your budget again";
/** Budgets can be set this month and up to 23 months ahead (BUDGET_MONTHS_AHEAD, the web's form). */
export const BUDGET_MONTH_COUNT = 24;

export type BudgetBadge = { label: string; tone: "danger" | "caution" | "neutral" };

/**
 * The level as words (never colour alone); none while within 80%. Red only once over budget;
 * near limit (80% to 100%) is amber on peach, matching its bar (owner, 13c PR 3).
 */
export function budgetBadge(status: BudgetStatus | null): BudgetBadge | null {
  if (!status) return { label: SET_BUDGET_AGAIN, tone: "neutral" };
  if (status.level === "over") return { label: "Over budget", tone: "danger" };
  if (status.level === "warning") return { label: "Near limit", tone: "caution" };
  return null;
}

/** Which colour a budget bar takes: forest within 80%, amber near the limit, red over it. */
export function budgetBarTone(status: BudgetStatus): "ok" | "caution" | "over" {
  return status.level === "over" ? "over" : status.level === "warning" ? "caution" : "ok";
}

/** "85%", rounded down so 99.6% never reads as 100% before the budget is used up. */
export function usedPercent(status: BudgetStatus): string {
  return `${Math.floor(status.usedBps / 100)}%`;
}

/** What a budget bar says to a screen reader: "Food: 85% used, near limit". */
export function budgetBarLabel(name: string, status: BudgetStatus): string {
  const level = status.level === "over" ? ", over budget" : status.level === "warning" ? ", near limit" : "";
  return `${name}: ${usedPercent(status)} used${level}`;
}

/** "left" while within the budget, "over" once spending passes it (the amount is shown unsigned). */
export function leftWord(status: BudgetStatus): "left" | "over" {
  return status.leftMinor < 0 ? "over" : "left";
}

/** "1 over budget · 2 near limit", or "All within budget". */
export function budgetsSummaryText(p: Pick<PlanBudgets, "overCount" | "warningCount" | "resetCount">): string {
  const parts = [
    p.overCount ? `${p.overCount} over budget` : "",
    p.warningCount ? `${p.warningCount} near limit` : "",
    p.resetCount ? `${p.resetCount} to set again` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "All within budget";
}

export type MonthOption = { value: string; label: string; start: IsoDate };

/** This month and the 23 after it, as "YYYY-MM" values with "Nov 2026" labels. */
export function budgetMonthOptions(today: IsoDate): MonthOption[] {
  const options: MonthOption[] = [];
  let start = monthRange(today).start;
  for (let k = 0; k < BUDGET_MONTH_COUNT; k++) {
    options.push({ value: start.slice(0, 7), label: monthLabel(start), start });
    start = addDays(monthRange(start).end, 1);
  }
  return options;
}

/** "This month · Nov 2026" or "Dec 2026". */
export function budgetMonthHeading(month: IsoDate, today: IsoDate): string {
  return month.slice(0, 7) === today.slice(0, 7) ? `This month · ${monthLabel(month)}` : monthLabel(month);
}

// ---- Goals (13c PR 3) ---------------------------------------------------------------------

/** Whole percent saved, rounded down (99.6% never reads as 100% before it is saved in full). */
export function savedPercent(progressBps: number): string {
  return `${Math.floor(progressBps / 100)}%`;
}

/** "Save ₹15,000 a month for 4 months (by 31 Mar 2027)", or the assumption, reached or passed text (the web's savingText). */
export function goalSavingText(item: { goal: Pick<GoalItem["goal"], "currency" | "targetMinor" | "targetDate">; plan: GoalItem["plan"] }): string {
  const { plan, goal } = item;
  const monthly = money(plan.monthlyMinor, goal.currency);
  switch (plan.basis) {
    case "reached":
      return goal.targetMinor === 0 ? "Nothing to save upfront" : "Saved in full";
    case "target_date":
      return `Save ${monthly} a month for ${plan.months} ${plan.months === 1 ? "month" : "months"} (by ${fullDate(goal.targetDate!)})`;
    case "assumed_months":
      return `Save ${monthly} a month, assuming 12 months (no target date)`;
    case "past_due":
      return `Target date ${fullDate(goal.targetDate!)} has passed: ${money(plan.remainingMinor, goal.currency)} still to save`;
  }
}

export type PaceTag = { label: string; tone: "neutral" | "caution" };

/** "On track" or "Behind" in words; none without a target date (no pace) or once saved in full. */
export function goalPaceTag(pace: GoalPace | null): PaceTag | null {
  if (!pace || pace.status === "reached") return null;
  return pace.status === "behind" ? { label: "Behind", tone: "caution" } : { label: "On track", tone: "neutral" };
}

/** "₹30,000 behind an even pace since you added it", only when behind. */
export function goalBehindText(pace: GoalPace | null, currency: string): string | null {
  return pace?.status === "behind" ? `${money(pace.shortMinor, currency)} behind an even pace since you added it` : null;
}

/** "1 behind · 2 on track" for the Plan card, or null when no goal has a pace. */
export function goalsSummaryText(paces: readonly (GoalPace | null)[]): string | null {
  const behind = paces.filter((p) => p?.status === "behind").length;
  const onTrack = paces.filter((p) => p?.status === "on_track").length;
  const parts = [behind ? `${behind} behind` : "", onTrack ? `${onTrack} on track` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
