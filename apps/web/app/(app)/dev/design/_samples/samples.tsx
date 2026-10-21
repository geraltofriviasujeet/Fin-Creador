// Sample finance components for design review only. Real versions are built in
// Sprints 3–6 against live data; promote and adapt these then rather than importing from here.
import type * as React from "react"
import {
  ArrowDownToLine,
  ArrowUpToLine,
  BriefcaseBusiness,
  Car,
  ChartNoAxesColumn,
  ChevronRight,
  Ellipsis,
  House,
  Plane,
  Plus,
  ShoppingCart,
  Sparkles,
  Wallet,
} from "lucide-react"
import { cn } from "cn"
import { formatMoney, formatPercentFromBasisPoints, ratioToBasisPoints } from "@fin-creador/domain"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DEMO_CURRENCY,
  type DemoGoal,
  type DemoTransaction,
  demoBudget,
  demoSummary,
} from "./demo-data"

const money = (amount: number, signed = false) => formatMoney(amount, { currency: DEMO_CURRENCY, signed })
const pct = (bp: number, signed = false, digits = 1) =>
  formatPercentFromBasisPoints(bp, { signed, maximumFractionDigits: digits })

function IconChip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5", className)}>
      {children}
    </span>
  )
}

function MoreButton({ label, onDark = false }: { label: string; onDark?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`More options for ${label}`}
      className={onDark ? "text-nav-text hover:bg-white/10" : "text-ink"}
    >
      <Ellipsis aria-hidden="true" />
    </Button>
  )
}

function Meter({ valueBp, label, className }: { valueBp: number; label: string; className: string }) {
  const percent = Math.max(0, Math.min(100, valueBp / 100))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-line"
    >
      <div className={cn("h-full rounded-full", className)} style={{ width: `${percent}%` }} />
    </div>
  )
}

/** Trend badge: sign is always visible; tone says whether the change is good. */
function Trend({ bp, goodWhenUp, onDark = false }: { bp: number; goodWhenUp: boolean; onDark?: boolean }) {
  const good = bp === 0 || bp > 0 === goodWhenUp
  return (
    <p className={cn("flex items-center gap-2 text-xs", onDark ? "text-nav-muted" : "text-muted-foreground")}>
      <Badge tone={onDark ? "onDark" : good ? "positive" : "negative"}>{pct(bp, true)}</Badge>
      from last month
    </p>
  )
}

const BIG_NUMBER = "font-heading text-3xl font-bold tracking-(--fc-tracking-heading) tabular-nums"

export function SummaryCards() {
  const { balance, income, expenses, savings } = demoSummary
  const maxBar = Math.max(...balance.sparkline)

  return (
    <div
      role="region"
      aria-label="Summary (demo data)"
      tabIndex={0}
      className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-4"
    >
      <Card tone="deep" className="flex min-w-61 snap-start flex-col md:min-w-0">
        <CardHeader className="items-center">
          <IconChip className="bg-white/10 text-nav-text">
            <Wallet aria-hidden="true" />
          </IconChip>
          <p className="mr-auto text-sm">Total balance</p>
          <MoreButton label="Total balance" onDark />
        </CardHeader>
        <p className={cn(BIG_NUMBER, "mt-6")}>{money(balance.amount)}</p>
        <div className="mt-2">
          <Trend bp={balance.trendBp} goodWhenUp onDark />
        </div>
        <svg aria-hidden="true" viewBox="0 0 124 40" className="mt-auto ml-auto h-10 w-31 pt-2">
          {balance.sparkline.map((v, i) => {
            const h = (v / maxBar) * 40
            return <rect key={i} x={i * 10.5} y={40 - h} width="6" height={h} rx="3" className="fill-brand" opacity={0.45 + (i / balance.sparkline.length) * 0.55} />
          })}
        </svg>
      </Card>

      <Card className="flex min-w-61 snap-start flex-col md:min-w-0">
        <CardHeader className="items-center">
          <IconChip className="bg-chip-mint text-ink">
            <ArrowDownToLine aria-hidden="true" />
          </IconChip>
          <p className="mr-auto text-sm text-muted-foreground">Income</p>
          <MoreButton label="Income" />
        </CardHeader>
        <p className={cn(BIG_NUMBER, "mt-6")}>{money(income.amount)}</p>
        <div className="mt-2">
          <Trend bp={income.trendBp} goodWhenUp />
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-xs text-muted-foreground">{income.sources}</p>
          <Button variant="secondary" size="icon-sm" aria-label="View income details" className="rounded-full">
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </Card>

      <Card className="flex min-w-61 snap-start flex-col md:min-w-0">
        <CardHeader className="items-center">
          <IconChip className="bg-chip-peach text-ink">
            <ArrowUpToLine aria-hidden="true" />
          </IconChip>
          <p className="mr-auto text-sm text-muted-foreground">Expenses</p>
          <MoreButton label="Expenses" />
        </CardHeader>
        <p className={cn(BIG_NUMBER, "mt-6")}>{money(expenses.amount)}</p>
        <div className="mt-2">
          <Trend bp={expenses.trendBp} goodWhenUp={false} />
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-xs text-muted-foreground">{expenses.count} transactions</p>
          <Button variant="secondary" size="icon-sm" aria-label="View expense transactions" className="rounded-full">
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </Card>

      <Card className="flex min-w-61 snap-start flex-col md:min-w-0">
        <CardHeader className="items-center">
          <IconChip className="bg-chip-lavender text-ink">
            <ChartNoAxesColumn aria-hidden="true" />
          </IconChip>
          <p className="mr-auto text-sm text-muted-foreground">Savings rate</p>
          <MoreButton label="Savings rate" />
        </CardHeader>
        <p className={cn(BIG_NUMBER, "mt-6")}>{pct(savings.rateBp)}</p>
        <div className="mt-2">
          <Trend bp={savings.trendBp} goodWhenUp />
        </div>
        <div className="mt-auto grid gap-2 pt-3">
          <Meter valueBp={savings.rateBp} label="Savings rate" className="bg-chart" />
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Saved {money(savings.saved)}</span>
            <span className="font-semibold text-chart">Great</span>
          </div>
        </div>
      </Card>
    </div>
  )
}

const TX_ICON: Record<DemoTransaction["kind"], { icon: React.ReactNode; chip: string }> = {
  groceries: { icon: <ShoppingCart aria-hidden="true" />, chip: "bg-chip-peach text-ink" },
  salary: { icon: <BriefcaseBusiness aria-hidden="true" />, chip: "bg-chip-mint text-ink" },
  transport: { icon: <Car aria-hidden="true" />, chip: "bg-chip-lavender text-ink" },
  housing: { icon: <House aria-hidden="true" />, chip: "bg-chip-blue text-ink" },
}

export function TransactionRow({ tx }: { tx: DemoTransaction }) {
  const { icon, chip } = TX_ICON[tx.kind]
  const income = tx.amount > 0
  return (
    <li className="flex items-center gap-3 border-b border-line py-3 last:border-b-0 md:gap-4">
      <IconChip className={chip}>{icon}</IconChip>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{tx.merchant}</p>
        <p className="truncate text-xs text-muted-foreground">
          {tx.category} · {tx.when}
        </p>
      </div>
      <p className={cn("text-sm font-semibold tabular-nums", income ? "text-success" : "text-ink")}>
        {money(tx.amount, true)}
      </p>
      <MoreButton label={tx.merchant} />
    </li>
  )
}

export function BudgetDonut() {
  const { spent, total, dailyGuide } = demoBudget
  const usedBp = ratioToBasisPoints(spent, total) ?? 0
  const left = total - spent
  const r = 52
  const circumference = 2 * Math.PI * r
  const filled = (Math.min(usedBp, 10_000) / 10_000) * circumference

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Monthly budget</CardTitle>
          <CardDescription className="mt-1">{money(left)} left to spend</CardDescription>
        </div>
        <MoreButton label="Monthly budget" />
      </CardHeader>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-6">
        <div className="relative size-36">
          <svg
            role="img"
            aria-label={`${pct(usedBp, false, 0)} of monthly budget used: ${money(spent)} of ${money(total)}`}
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
              className="stroke-brand-deep"
            />
          </svg>
          <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-heading text-2xl font-bold tabular-nums">{pct(usedBp, false, 0)}</span>
            <span className="text-xs text-muted-foreground">used</span>
          </div>
        </div>
        <div aria-hidden="true" className="grid gap-1">
          <span className="text-xs text-muted-foreground">Spent</span>
          <span className="font-heading text-2xl font-bold tabular-nums">{money(spent)}</span>
          <span className="text-xs text-muted-foreground">of {money(total)}</span>
        </div>
      </div>
      <p className="mt-6 flex items-start gap-2 rounded-xl bg-chip-mint px-4 py-3 text-sm">
        <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
        <span>
          <strong className="font-semibold">You’re on track.</strong> Keep daily spending below {money(dailyGuide)}.
        </span>
      </p>
    </Card>
  )
}

const GOAL_ICON: Record<DemoGoal["kind"], React.ReactNode> = {
  travel: <Plane aria-hidden="true" />,
  home: <House aria-hidden="true" />,
}

export function GoalRow({ goal }: { goal: DemoGoal }) {
  const progressBp = ratioToBasisPoints(goal.saved, goal.target) ?? 0
  return (
    <li className="flex gap-3 border-b border-line py-4 last:border-b-0 md:gap-4">
      <IconChip className="bg-canvas text-ink">{GOAL_ICON[goal.kind]}</IconChip>
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm font-semibold">{goal.name}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {money(goal.saved)} of {money(goal.target)}
          </p>
        </div>
        <Meter valueBp={progressBp} label={`${goal.name} progress`} className={goal.kind === "travel" ? "bg-brand-deep" : "bg-chart"} />
        <p className="text-xs text-muted-foreground">
          {pct(progressBp)} · {goal.timeLeft}
        </p>
      </div>
    </li>
  )
}

export function AddGoalButton() {
  return (
    <Button variant="secondary" size="icon" aria-label="Add goal">
      <Plus aria-hidden="true" />
    </Button>
  )
}
