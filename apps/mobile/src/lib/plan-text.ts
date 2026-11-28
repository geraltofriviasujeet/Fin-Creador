import { type PlanBudgets, monthLabel } from "@fin-creador/api";
import { type BudgetStatus, type IsoDate, addDays, monthRange } from "@fin-creador/domain";

// Words for the phone's Plan tab and Budgets screen (Sprint 13c). Same wording as the web Goals
// page (apps/web/components/goals/display.tsx): "Over budget" at 100%, "Near limit" from the
// domain's 80% (budgetStatus), "Set your budget again" for a budget in another currency. No Intl
// (Hermes): months come from monthLabel, percentages are whole numbers worked out here.

export const SET_BUDGET_AGAIN = "Set your budget again";
/** Budgets can be set this month and up to 23 months ahead (BUDGET_MONTHS_AHEAD, the web's form). */
export const BUDGET_MONTH_COUNT = 24;

export type BudgetBadge = { label: string; tone: "warning" | "neutral" };

/** The level as words (never colour alone); none while within 80%. */
export function budgetBadge(status: BudgetStatus | null): BudgetBadge | null {
  if (!status) return { label: SET_BUDGET_AGAIN, tone: "neutral" };
  if (status.level === "over") return { label: "Over budget", tone: "warning" };
  if (status.level === "warning") return { label: "Near limit", tone: "neutral" };
  return null;
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
