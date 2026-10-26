import Link from "next/link"
import { ChevronRight } from "lucide-react"
import type { GoalsView } from "@fin-creador/api"
import { money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Card, CardTitle } from "@/components/ui/card"
import { BudgetBadge, BudgetDonut, GoalSummary, SET_BUDGET_AGAIN, pct } from "./display"

// The Overview's Monthly budget and Your goals cards (Sprint 6). Budgets always show the
// current month, whatever period the Overview is set to.

function OpenGoals({ children }: { children: React.ReactNode }) {
  return (
    <Link href="/goals" className="inline-flex items-center gap-1 text-sm font-semibold text-ink underline-offset-4 hover:underline">
      {children}
      <ChevronRight aria-hidden="true" className="size-4" />
    </Link>
  )
}

function Unavailable({ id, title }: { id: string; title: string }) {
  return (
    <Card aria-labelledby={id} className="grid content-start gap-2">
      <CardTitle id={id}>{title}</CardTitle>
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load this. <Link href="/" className="font-semibold text-ink underline underline-offset-4">Try again</Link>
      </p>
    </Card>
  )
}

export function BudgetOverviewCard({ view }: { view: GoalsView | null }) {
  if (!view) return <Unavailable id="budget-title" title="Monthly budget" />
  const { total, currency } = view
  const flagged = view.budgets.filter((b) => b.status && b.status.level !== "ok")
  const reset = view.budgets.filter((b) => !b.status)
  return (
    <Card aria-labelledby="budget-title" className="grid content-start gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle id="budget-title">Monthly budget</CardTitle>
        <Badge tone="neutral">This month</Badge>
      </div>
      {total ? (
        <>
          <div className="flex flex-wrap items-center justify-center gap-5">
            <BudgetDonut status={total} currency={currency} />
            <div className="grid gap-1 text-sm">
              <p className="font-heading text-lg font-bold tabular-nums">
                {total.leftMinor >= 0 ? `${money(total.leftMinor, currency)} left` : `${money(-total.leftMinor, currency)} over`}
              </p>
              <p className="text-muted-foreground tabular-nums">
                {money(total.spentMinor, currency)} of {money(total.budgetMinor, currency)}
              </p>
              <BudgetBadge status={total} />
            </div>
          </div>
          {flagged.length > 0 && (
            <ul className="grid gap-1.5 text-sm">
              {flagged.slice(0, 3).map((b) => (
                <li key={b.category.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{b.category.name}</span>
                  <span className="flex items-center gap-2 text-muted-foreground tabular-nums">
                    {pct(b.status!.usedBps)} used <BudgetBadge status={b.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {view.budgets.length > 0 ? `Your budgets are in another currency. ${SET_BUDGET_AGAIN} in ${currency}.` : "Set a monthly amount per category and see what's left to spend."}
        </p>
      )}
      {reset.length > 0 && total && (
        <p className="text-sm text-muted-foreground">
          {reset.length} {reset.length === 1 ? "budget is" : "budgets are"} in another currency: {SET_BUDGET_AGAIN.toLowerCase()}.
        </p>
      )}
      <OpenGoals>{view.budgets.length > 0 ? "See all budgets" : "Set a budget"}</OpenGoals>
    </Card>
  )
}

export function GoalsOverviewCard({ view }: { view: GoalsView | null }) {
  if (!view) return <Unavailable id="goals-title" title="Your goals" />
  return (
    <Card aria-labelledby="goals-title" className="grid content-start gap-2">
      <CardTitle id="goals-title">Your goals</CardTitle>
      {view.active.length > 0 ? (
        <ul>
          {view.active.slice(0, 3).map((item) => (
            <GoalSummary key={item.goal.id} item={item} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Plan a trip, a car, a home or something else, and see how much to save each month.</p>
      )}
      <OpenGoals>{view.active.length > 0 ? `View all (${view.active.length})` : "Plan an expense"}</OpenGoals>
    </Card>
  )
}
