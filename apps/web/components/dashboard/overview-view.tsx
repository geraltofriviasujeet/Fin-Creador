import type * as React from "react"
import Link from "next/link"
import { ArrowDownRight, ArrowDownToLine, ArrowRight, ArrowUpFromLine, ArrowUpRight, ChevronRight, Inbox, PiggyBank, Wallet } from "lucide-react"
import {
  type ChartChoices,
  type DashboardBreakdown,
  type GoalsView,
  type InvestmentsView,
  CHART_OPTIONS,
  DEFAULT_CHARTS,
  type LedgerItem,
  type Lookup,
  ledgerLookup,
  type TransactionTotals,
  type TransactionsContext,
  dashboardQuery,
  transactionsHref,
} from "@fin-creador/api"
import {
  type Comparison,
  type DashboardPeriod,
  type DateRange,
  DASHBOARD_PERIODS,
  addMinor,
  bucketSizeFor,
  changeBasisPoints,
  formatMoney,
  formatPercentFromBasisPoints,
  pointsChange,
  ratioToBasisPoints,
  savingsRateBasisPoints,
  summarizeHoldings,
} from "@fin-creador/domain"
import { cn } from "cn"
import { PageHeader } from "@/components/shell/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { TextField } from "@/components/ui/field"
import { EntryIcon, dayHeading, entryKindLabel, entryTitle, fullDate, money, rangeText, signedAmount } from "@/components/transactions/display"
import { BudgetOverviewCard, GoalsOverviewCard } from "@/components/goals/overview-cards"
import { InvestmentsOverviewCard } from "@/components/investments/overview-card"
import { CategoryPie } from "./category-pie"
import { TimeChart } from "./time-chart"

export const OVERVIEW_HEADER = { title: "Overview", description: "Your money at a glance." }

const PERIOD_PHRASE: Record<DashboardPeriod, string> = {
  week: "this week",
  month: "this month",
  year: "this year",
  custom: "in this range",
}

export type OverviewViewProps = {
  context: TransactionsContext
  name: string | null
  period: DashboardPeriod
  range: DateRange
  comparison: Comparison | null
  totals: TransactionTotals
  prevTotals: TransactionTotals | null
  breakdown: DashboardBreakdown
  recent: LedgerItem[]
  charts: ChartChoices
  /** The Recurring card (null when recurring items couldn't load). */
  upcoming: React.ReactNode
  /** Budgets and goals (null when they couldn't load; the cards say so). */
  goals: GoalsView | null
  /** Holdings tracker (null when it couldn't load; the card says so). Not in Total available. */
  investments: InvestmentsView | null
}

function greeting(name: string | null, timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date()))
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"
  const first = name?.trim().split(/\s+/)[0]
  return first ? `Good ${part}, ${first}` : `Good ${part}`
}

function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number]
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function OverviewView({ context, name, period, range, comparison, totals, prevTotals, breakdown, recent, charts, upcoming, goals, investments }: OverviewViewProps) {
  const { today, currency, timeZone } = context
  const lookup: Lookup = ledgerLookup(context)
  const holdings = summarizeHoldings(context.accounts, currency)
  const otherAccounts = holdings.rows.filter((r) => !r.inTotal).length
  const savingsRate = savingsRateBasisPoints(totals)
  const prevSavingsRate = prevTotals ? savingsRateBasisPoints(prevTotals) : null
  const vs = comparison?.label ?? ""
  const hasSpending = breakdown.buckets.some((b) => b.expenseMinor > 0)
  const hasActivity = breakdown.buckets.some((b) => b.expenseMinor > 0 || b.incomeMinor > 0)

  return (
    <>
      <PageHeader
        eyebrow={longDate(today)}
        title={greeting(name, timeZone)}
        description={`Here’s how your money is looking ${PERIOD_PHRASE[period]}.`}
        actions={<PeriodSwitcher period={period} charts={charts} />}
      />

      {period === "custom" && <CustomRangeForm range={range} today={today} charts={charts} />}

      {!context.hasEntries && <FirstRun hasAccounts={holdings.rows.length > 0} />}

      <section aria-label={`Summary ${PERIOD_PHRASE[period]}`} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          tone="deep"
          icon={<Wallet aria-hidden="true" className="size-5" />}
          label="Total balance"
          value={money(holdings.totalAvailableMinor, currency)}
          footer={
            holdings.rows.length === 0 ? (
              <FooterLink href="/income" dark>
                Add an account
              </FooterLink>
            ) : (
              <FooterLink href="/income" dark>
                Across {holdings.rows.length - otherAccounts} {holdings.rows.length - otherAccounts === 1 ? "account" : "accounts"} today
              </FooterLink>
            )
          }
        />
        <SummaryCard
          icon={<ArrowDownToLine aria-hidden="true" className="size-5" />}
          chip="bg-chip-mint"
          label="Income"
          value={money(totals.incomeMinor, currency)}
          change={<Change bp={prevTotals ? changeBasisPoints(totals.incomeMinor, prevTotals.incomeMinor) : null} upIsGood vs={vs} />}
          footer={
            <FooterLink href={transactionsHref(range, { type: "income" })}>
              {totals.incomeCount} income {totals.incomeCount === 1 ? "entry" : "entries"}
            </FooterLink>
          }
        />
        <SummaryCard
          icon={<ArrowUpFromLine aria-hidden="true" className="size-5" />}
          chip="bg-chip-peach"
          label="Expenses"
          value={money(totals.expenseMinor, currency)}
          change={<Change bp={prevTotals ? changeBasisPoints(totals.expenseMinor, prevTotals.expenseMinor) : null} upIsGood={false} vs={vs} />}
          footer={
            <FooterLink href={transactionsHref(range, { type: "expense" })}>
              {totals.expenseCount} {totals.expenseCount === 1 ? "expense" : "expenses"}
            </FooterLink>
          }
        />
        <SummaryCard
          icon={<PiggyBank aria-hidden="true" className="size-5" />}
          chip="bg-chip-lavender"
          label="Savings rate"
          value={savingsRate === null ? "—" : formatPercentFromBasisPoints(savingsRate)}
          change={<Change bp={pointsChange(savingsRate, prevSavingsRate)} points upIsGood vs={vs} />}
          footer={
            <span>
              {savingsRate === null ? "No income in this period · " : ""}
              Net cash flow{" "}
              <span className={cn("font-semibold tabular-nums", totals.netMinor < 0 ? "text-danger" : "text-ink")}>
                {formatMoney(totals.netMinor, { currency, signed: true })}
              </span>
            </span>
          }
        />
      </section>
      <p className="mt-3 mb-4 text-xs text-muted-foreground">
        {rangeText(range)}
        {comparison && `, compared with ${rangeText(comparison.previous)}`}. Transfers between your accounts aren’t income or expenses; voided entries never count.
        {totals.otherCurrencyCount > 0 &&
          ` ${totals.otherCurrencyCount} ${totals.otherCurrencyCount === 1 ? "entry" : "entries"} in other currencies (${breakdown.otherCurrencies.join(", ")}) aren’t included.`}
        {otherAccounts > 0 && ` ${otherAccounts} ${otherAccounts === 1 ? "account" : "accounts"} in other currencies aren’t in the total balance.`}
      </p>

      <div className="grid gap-4 lg:grid-cols-[1.75fr_1fr]">
        <Card aria-labelledby="spending-title">
          <CardHeading id="spending-title" title="Spending overview" switcher={hasSpending && <ChartSwitch chart="spending" title="Spending overview" period={period} range={range} charts={charts} />}>
            Your expenses {PERIOD_PHRASE[period]}, {breakdownUnit(range)}
          </CardHeading>
          {hasSpending ? (
            <TimeChart kind={charts.spending} buckets={breakdown.buckets} range={range} series={["expense"]} currency={currency} summary={chartSummary(breakdown, range, currency)} />
          ) : (
            <EmptyPanel>No spending recorded {PERIOD_PHRASE[period]}.</EmptyPanel>
          )}
        </Card>
        <CategoryCard breakdown={breakdown} range={range} currency={currency} lookup={lookup} period={period} charts={charts} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.75fr_1fr]">
        <Card aria-labelledby="flow-title">
          <CardHeading id="flow-title" title="Income vs expenses" switcher={hasActivity && <ChartSwitch chart="flow" title="Income vs expenses" period={period} range={range} charts={charts} />}>
            Money in and out {PERIOD_PHRASE[period]}, {breakdownUnit(range)}
          </CardHeading>
          {hasActivity ? (
            <TimeChart
              kind={charts.flow}
              buckets={breakdown.buckets}
              range={range}
              series={["income", "expense"]}
              currency={currency}
              summary={`Income ${money(totals.incomeMinor, currency)} and expenses ${money(totals.expenseMinor, currency)} ${PERIOD_PHRASE[period]}, ${rangeText(range)}.`}
            />
          ) : (
            <EmptyPanel>No income or expenses recorded {PERIOD_PHRASE[period]}.</EmptyPanel>
          )}
        </Card>
        <BudgetOverviewCard view={goals} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <RecentCard recent={recent} lookup={lookup} today={today} />
        <div className="grid content-start gap-4">
          {upcoming}
          <GoalsOverviewCard view={goals} />
          <InvestmentsOverviewCard view={investments} />
        </div>
      </div>
    </>
  )
}

function breakdownUnit(range: DateRange): string {
  return bucketSizeFor(range) === "day" ? "by day" : "by month"
}

function chartSummary(breakdown: DashboardBreakdown, range: DateRange, currency: string): string {
  const highest = breakdown.buckets.reduce((a, b) => (b.expenseMinor > a.expenseMinor ? b : a))
  const total = addMinor(...breakdown.buckets.map((b) => b.expenseMinor))
  const when = bucketSizeFor(range) === "day" ? fullDate(highest.start) : `the month starting ${fullDate(highest.start)}`
  return `Expenses ${breakdownUnit(range)}, ${rangeText(range)}: ${money(total, currency)} in total; highest ${money(highest.expenseMinor, currency)} on ${when}. "Show as a table" lists every amount.`
}

function CardHeading({ id, title, switcher, children }: { id: string; title: string; switcher?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <CardTitle id={id}>{title}</CardTitle>
        <CardDescription className="mt-1">{children}</CardDescription>
      </div>
      {switcher}
    </div>
  )
}

/** Chart type links (kept in the URL with the period and the other charts' types). */
function ChartSwitch<K extends keyof ChartChoices>({
  chart,
  title,
  period,
  range,
  charts,
}: {
  chart: K
  title: string
  period: DashboardPeriod
  range: DateRange
  charts: ChartChoices
}) {
  return (
    <nav aria-label={`Chart type for ${title}`}>
      <ul className="flex rounded-lg bg-canvas p-0.5">
        {CHART_OPTIONS[chart].map((o) => (
          <li key={o.value}>
            <Link
              href={`/${dashboardQuery(period, range, { ...charts, [chart]: o.value })}`}
              aria-current={charts[chart] === o.value ? "true" : undefined}
              scroll={false}
              className={cn(
                "flex min-h-8 items-center rounded-md px-3 text-xs font-semibold text-muted-foreground transition-colors motion-reduce:transition-none",
                "hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-deep",
                charts[chart] === o.value && "bg-surface text-ink shadow-sm"
              )}
            >
              {o.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function PeriodSwitcher({ period, charts }: { period: DashboardPeriod; charts: ChartChoices }) {
  return (
    <nav aria-label="Period">
      <ul className="flex rounded-xl bg-line/60 p-1">
        {DASHBOARD_PERIODS.map((p) => (
          <li key={p.value}>
            <Link
              href={`/${dashboardQuery(p.value, undefined, charts)}`}
              aria-current={p.value === period ? "page" : undefined}
              scroll={false}
              className={cn(
                "flex min-h-10 items-center rounded-lg px-4 text-sm font-semibold text-muted-foreground transition-colors motion-reduce:transition-none",
                "hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-deep",
                p.value === period && "bg-surface text-ink shadow-sm"
              )}
            >
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// A plain GET form: works without JavaScript and keeps the range in the URL.
function CustomRangeForm({ range, today, charts }: { range: DateRange; today: string; charts: ChartChoices }) {
  return (
    <Card className="mb-4">
      <form action="/" method="get" className="grid items-end gap-4 md:grid-cols-[1fr_1fr_auto]">
        <input type="hidden" name="period" value="custom" />
        <TextField name="from" type="date" label="From" max={today} defaultValue={range.start} required />
        <TextField name="to" type="date" label="To" max={today} defaultValue={range.end} required />
        <Button type="submit">Show range</Button>
        {(["spending", "flow", "categories"] as const).map((key) =>
          charts[key] !== DEFAULT_CHARTS[key] ? <input key={key} type="hidden" name={key} value={charts[key]} /> : null
        )}
      </form>
    </Card>
  )
}

function FirstRun({ hasAccounts }: { hasAccounts: boolean }) {
  return (
    <Card className="mb-4 flex flex-col items-start gap-4 md:flex-row md:items-center">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-chip-mint text-ink">
        <Inbox aria-hidden="true" className="size-6" />
      </span>
      <div className="grid flex-1 gap-1">
        <h2 className="text-lg font-semibold">Nothing recorded yet</h2>
        <p className="text-sm text-muted-foreground">
          {hasAccounts
            ? "Your income, spending and charts will appear here as you record entries."
            : "Start by adding your bank accounts and cash on the Income page; then record income and expenses."}
        </p>
      </div>
      <Link href={hasAccounts ? "/transactions?add=expense" : "/income"} className={cn(buttonVariants())}>
        {hasAccounts ? "Add an expense" : "Go to Income"}
        <ArrowRight aria-hidden="true" />
      </Link>
    </Card>
  )
}

function SummaryCard({
  tone = "default",
  icon,
  chip,
  label,
  value,
  change,
  footer,
}: {
  tone?: "default" | "deep"
  icon: React.ReactNode
  chip?: string
  label: string
  value: string
  change?: React.ReactNode
  footer: React.ReactNode
}) {
  const deep = tone === "deep"
  return (
    <Card tone={tone} className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className={cn("flex size-10 items-center justify-center rounded-xl", deep ? "bg-white/10 text-brand" : cn(chip, "text-ink"))}>{icon}</span>
        <h2 className={cn("text-sm", deep ? "text-nav-text" : "text-muted-foreground")}>{label}</h2>
      </div>
      <p className="font-heading text-3xl font-semibold tracking-(--fc-tracking-heading) tabular-nums">{value}</p>
      {change ?? <span className="h-5" aria-hidden="true" />}
      <div className={cn("mt-auto border-t pt-3 text-sm", deep ? "border-white/10 text-nav-text" : "border-line text-muted-foreground")}>{footer}</div>
    </Card>
  )
}

function FooterLink({ href, dark = false, children }: { href: string; dark?: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn("flex items-center justify-between gap-2 underline-offset-4 hover:underline", dark && "text-nav-text")}>
      <span>{children}</span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
    </Link>
  )
}

/** A trend badge: arrow, sign and words, so colour is never the only signal. "—" when there is nothing to compare with. */
function Change({ bp, upIsGood, points = false, vs }: { bp: number | null; upIsGood: boolean; points?: boolean; vs: string }) {
  if (bp === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge tone="neutral">—</Badge>
        <span>{vs ? `${vs} (nothing to compare)` : "nothing to compare"}</span>
      </p>
    )
  }
  const text = points
    ? `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(bp / 100)} pts`
    : formatPercentFromBasisPoints(bp, { signed: true })
  const tone = bp === 0 ? "neutral" : bp > 0 === upIsGood ? "positive" : "negative"
  const Icon = bp > 0 ? ArrowUpRight : bp < 0 ? ArrowDownRight : null
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <Badge tone={tone}>
        {Icon && <Icon aria-hidden="true" className="size-3.5" />}
        {text}
      </Badge>
      <span>{vs}</span>
    </p>
  )
}

function CategoryCard({
  breakdown,
  range,
  currency,
  lookup,
  period,
  charts,
}: {
  breakdown: DashboardBreakdown
  range: DateRange
  currency: string
  lookup: Lookup
  period: DashboardPeriod
  charts: ChartChoices
}) {
  const total = addMinor(...breakdown.categories.map((c) => c.expenseMinor))
  const largest = breakdown.categories[0]?.expenseMinor ?? 0
  return (
    <Card aria-labelledby="categories-title">
      <CardHeading
        id="categories-title"
        title="Spending by category"
        switcher={breakdown.categories.length > 0 && <ChartSwitch chart="categories" title="Spending by category" period={period} range={range} charts={charts} />}
      >
        Top five {PERIOD_PHRASE[period]}
      </CardHeading>
      {breakdown.categories.length === 0 ? (
        <EmptyPanel>No spending recorded {PERIOD_PHRASE[period]}.</EmptyPanel>
      ) : charts.categories === "pie" ? (
        <CategoryPie categories={breakdown.categories} range={range} currency={currency} lookup={lookup} />
      ) : (
        <ul aria-label="Categories" className="grid gap-3.5">
          {breakdown.categories.map((c) => {
            const category = c.categoryId ? lookup.categories.get(c.categoryId) : undefined
            const label = c.categoryId === null ? "Everything else" : `${category?.name ?? "Category"}${category?.archived ? " (archived)" : ""}`
            const share = ratioToBasisPoints(c.expenseMinor, total) ?? 0
            const body = (
              <>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-semibold">{label}</span>
                  <span className="shrink-0 tabular-nums">
                    {money(c.expenseMinor, currency)} <span className="text-xs text-muted-foreground">· {formatPercentFromBasisPoints(share)}</span>
                  </span>
                </span>
                <span aria-hidden="true" className="mt-1.5 block h-2 rounded-full bg-canvas">
                  <span className="block h-2 rounded-full bg-chart" style={{ width: `${Math.max((c.expenseMinor / largest) * 100, 2)}%` }} />
                </span>
              </>
            )
            return (
              <li key={c.categoryId ?? "rest"}>
                {c.categoryId ? (
                  <Link href={transactionsHref(range, { type: "expense", categoryId: c.categoryId })} className="block rounded-lg underline-offset-4 hover:underline">
                    {body}
                  </Link>
                ) : (
                  <div>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function RecentCard({ recent, lookup, today }: { recent: LedgerItem[]; lookup: Lookup; today: string }) {
  return (
    <Card aria-labelledby="recent-title" className="px-0 md:px-0">
      <div className="flex items-start justify-between gap-3 px-5 md:px-6">
        <div>
          <CardTitle id="recent-title">Recent transactions</CardTitle>
          <CardDescription className="mt-1">Your latest entries, any date</CardDescription>
        </div>
        <Link href="/transactions" className="flex min-h-10 items-center gap-1 text-sm font-semibold text-success underline-offset-4 hover:underline">
          View all
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      {recent.length === 0 ? (
        <p className="px-5 pt-4 text-sm text-muted-foreground md:px-6">No entries yet. Use “Add transaction” to record your first one.</p>
      ) : (
        <ul className="mt-4 border-t border-line">
          {recent.map((e) => (
            <li key={e.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0 md:gap-4 md:px-6">
              <EntryIcon entry={e} lookup={lookup} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{entryTitle(e, lookup)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {entryKindLabel(e, lookup)} · {dayHeading(e.occurredOn, today)}
                </p>
              </div>
              <p className={cn("shrink-0 text-right text-sm font-semibold tabular-nums", e.type === "income" ? "text-success" : "text-ink")}>{signedAmount(e)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}


function EmptyPanel({ children }: { children: React.ReactNode }) {
  return <p className="flex min-h-32 items-center justify-center rounded-xl bg-canvas px-4 text-center text-sm text-muted-foreground">{children}</p>
}

export function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading overview">
      <PageHeader title={OVERVIEW_HEADER.title} description={OVERVIEW_HEADER.description} />
      <div className="mb-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="grid gap-4">
            <span className="h-4 w-28 rounded bg-canvas" />
            <span className="h-9 w-40 rounded bg-canvas" />
            <span className="h-4 w-32 rounded bg-canvas" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.75fr_1fr]">
        {[0, 1].map((i) => (
          <Card key={i} className="grid gap-4">
            <span className="h-5 w-40 rounded bg-canvas" />
            <span className="h-48 w-full rounded-xl bg-canvas" />
          </Card>
        ))}
      </div>
    </div>
  )
}
