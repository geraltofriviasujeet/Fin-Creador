import type * as React from "react"
import { Armchair, Bike, Car, House, Laptop, Plane, Smartphone, Sparkles, Truck } from "lucide-react"
import type { BudgetItem, GoalItem } from "@fin-creador/api"
import { type BudgetStatus, type GoalType, formatPercentFromBasisPoints } from "@fin-creador/domain"
import { cn } from "cn"
import { fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"

// Display pieces shared by the Goals page and the Overview cards (Sprint 6). Figures come
// from packages/domain through the shared view (packages/api/src/goals/view.ts).

export const GOALS_HEADER = {
  eyebrow: "Plan ahead",
  title: "Goals",
  description: "Planned expenses and monthly budgets. Every figure comes from the amounts you enter.",
}

export const SET_BUDGET_AGAIN = "Set your budget again"

export const GOAL_ICON: Record<GoalType, React.ReactNode> = {
  trip: <Plane aria-hidden="true" />,
  vehicle: <Car aria-hidden="true" />,
  house: <House aria-hidden="true" />,
  furniture: <Armchair aria-hidden="true" />,
  electronics: <Laptop aria-hidden="true" />,
  mobile: <Smartphone aria-hidden="true" />,
  other: <Sparkles aria-hidden="true" />,
}

/** The goal's icon; a vehicle shows its kind (bike, car or HMV). */
export function goalIcon(item: GoalItem): React.ReactNode {
  if (item.answers?.type === "vehicle") {
    if (item.answers.details.vehicle === "bike") return <Bike aria-hidden="true" />
    if (item.answers.details.vehicle === "hmv") return <Truck aria-hidden="true" />
  }
  return GOAL_ICON[item.goal.type as GoalType] ?? GOAL_ICON.other
}

export const pct = (bp: number) => formatPercentFromBasisPoints(bp, { maximumFractionDigits: 0 })

export function IconChip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl bg-canvas text-ink [&_svg]:size-5", className)}>{children}</span>
}

/** Thin progress bar; the figure is always also given as text next to it. */
export function Meter({ valueBp, label, tone = "default" }: { valueBp: number; label: string; tone?: "default" | "warning" | "over" }) {
  const percent = Math.max(0, Math.min(100, valueBp / 100))
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div
        className={cn("h-full rounded-full", tone === "over" ? "bg-danger" : tone === "warning" ? "bg-chart" : "bg-brand-deep")}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

/** Level as text (never colour alone): "Over budget" at 100%, "Near limit" from 80%. */
export function BudgetBadge({ status }: { status: BudgetStatus | null }) {
  if (!status) return <Badge tone="info">{SET_BUDGET_AGAIN}</Badge>
  if (status.level === "over") return <Badge tone="negative">Over budget</Badge>
  if (status.level === "warning") return <Badge tone="info">Near limit</Badge>
  return null
}

/** "₹500 / ₹7,500" this month (profile currency only), or the budget's own currency on a mismatch. */
export function budgetAmounts(item: BudgetItem, currency: string): string {
  if (!item.status) return money(item.budget.amountMinor, item.budget.currency)
  return `${money(item.status.spentMinor, currency)} / ${money(item.status.budgetMinor, currency)}`
}

/** Donut for the month's budgets together (Overview and the Goals page). */
export function BudgetDonut({ status, currency }: { status: BudgetStatus; currency: string }) {
  const r = 52
  const circumference = 2 * Math.PI * r
  const filled = (Math.min(status.usedBps, 10_000) / 10_000) * circumference
  return (
    <div className="relative size-[120px] shrink-0">
      <svg
        role="img"
        aria-label={`${pct(status.usedBps)} of this month's budgets used: ${money(status.spentMinor, currency)} of ${money(status.budgetMinor, currency)}`}
        viewBox="0 0 120 120"
        className="size-full -rotate-90"
      >
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="12" className="stroke-line" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className={status.level === "over" ? "stroke-danger" : status.level === "warning" ? "stroke-chart" : "stroke-brand-deep"}
        />
      </svg>
      <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-heading text-xl font-bold tabular-nums">{pct(status.usedBps)}</span>
        <span className="text-xs text-muted-foreground">used</span>
      </div>
    </div>
  )
}

/** "₹15,000 a month until March 2027", or the assumption / reached / overdue text. */
export function savingText(item: GoalItem): string {
  const { plan, goal } = item
  const monthly = money(plan.monthlyMinor, goal.currency)
  switch (plan.basis) {
    case "reached":
      return item.goal.targetMinor === 0 ? "Nothing to save upfront" : "Saved in full"
    case "target_date":
      return `${monthly} a month for ${plan.months} ${plan.months === 1 ? "month" : "months"} (by ${fullDate(goal.targetDate!)})`
    case "assumed_months":
      return `${monthly} a month, assuming 12 months (no target date)`
    case "past_due":
      return `Target date ${fullDate(goal.targetDate!)} has passed: ${money(plan.remainingMinor, goal.currency)} still to save`
  }
}

/** One goal as a compact row (Overview card, archived list). */
export function GoalSummary({ item, children }: { item: GoalItem; children?: React.ReactNode }) {
  const { goal, plan } = item
  return (
    <li className="flex gap-3 border-b border-line py-4 last:border-b-0">
      <IconChip>{goalIcon(item)}</IconChip>
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="truncate text-sm font-semibold">{goal.name}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {money(goal.savedMinor, goal.currency)} of {money(goal.targetMinor, goal.currency)}
          </p>
        </div>
        {plan.progressBps !== null && <Meter valueBp={plan.progressBps} label={`${goal.name}: ${pct(plan.progressBps)} saved`} />}
        <p className="text-xs text-muted-foreground">{savingText(item)}</p>
      </div>
      {children}
    </li>
  )
}
