import type { Metadata } from "next"
import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  buildGoalsView,
  buildInvestmentsView,
  buildLoansView,
  buildRecurringView,
  loadGoalsData,
  loadInvestmentsData,
  loadLoansData,
  loadDashboardBreakdown,
  loadRecurringData,
  loadTransactionPage,
  loadTransactionTotals,
  loadTransactionsContext,
  readDashboardParams,
} from "@fin-creador/api"
import { comparisonFor } from "@fin-creador/domain"
import { OVERVIEW_HEADER, OverviewSkeleton, OverviewView } from "@/components/dashboard/overview-view"
import { UpcomingSection } from "@/components/recurring/upcoming"
import { PageHeader } from "@/components/shell/app-shell"
import { FormMessage } from "@/components/ui/field"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Overview" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// Overview dashboard (Sprint 5): read as the signed-in user (RLS). Totals come from
// transaction_summary (the same as the Transactions page), charts from dashboard_breakdown,
// periods and comparisons from packages/domain. Nothing is shown that isn't in the data.
export default function OverviewPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewContent searchParams={searchParams} />
    </Suspense>
  )
}

/** The earliest date the "Recent transactions" list looks back to (any period). */
const ALL_TIME_START = "1900-01-01"

async function OverviewContent({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams
  const params = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])))
  const supabase = await createClient()

  const context = await loadTransactionsContext(supabase)
  if (!context.ok && context.reason === "unauthenticated") redirect("/sign-in")
  if (!context.ok) return <LoadError />

  const { today, currency } = context.data
  const { period, range, charts } = readDashboardParams(params, today)
  const comparison = comparisonFor(period, range, today)

  const [totals, prevTotals, breakdown, recent, recurring, profile, goals, investments, loans] = await Promise.all([
    loadTransactionTotals(supabase, { from: range.start, to: range.end }, currency),
    comparison ? loadTransactionTotals(supabase, { from: comparison.previous.start, to: comparison.previous.end }, currency) : null,
    loadDashboardBreakdown(supabase, range, currency),
    loadTransactionPage(supabase, { from: ALL_TIME_START, to: today }, { currency, limit: 5 }),
    loadRecurringData(supabase),
    supabase.from("profiles").select("display_name").maybeSingle(),
    loadGoalsData(supabase),
    loadInvestmentsData(supabase),
    loadLoansData(supabase),
  ])
  if (!totals.ok || (prevTotals && !prevTotals.ok) || !breakdown.ok || !recent.ok) return <LoadError />

  // The Recurring card is optional: if it can't load, the rest of the Overview still shows.
  const upcoming = recurring.ok ? (
    <UpcomingSection
      view={buildRecurringView({ ...recurring.data, ...context.data })}
      accounts={context.data.accounts}
      categories={context.data.categories}
      today={today}
      currency={currency}
    />
  ) : null

  return (
    <OverviewView
      context={context.data}
      name={profile.data?.display_name ?? null}
      period={period}
      range={range}
      comparison={comparison}
      totals={totals.totals}
      prevTotals={prevTotals?.ok ? prevTotals.totals : null}
      breakdown={breakdown.data}
      recent={recent.items}
      charts={charts}
      upcoming={upcoming}
      goals={goals.ok ? buildGoalsView(goals.data) : null}
      investments={investments.ok ? buildInvestmentsView(investments.data) : null}
      loans={loans.ok ? buildLoansView(loans.data) : null}
    />
  )
}

function LoadError() {
  return (
    <>
      <PageHeader title={OVERVIEW_HEADER.title} description={OVERVIEW_HEADER.description} />
      <FormMessage tone="error">
        We couldn’t load your overview.{" "}
        <Link href="/" className="font-semibold underline underline-offset-4">
          Try again
        </Link>
      </FormMessage>
    </>
  )
}
