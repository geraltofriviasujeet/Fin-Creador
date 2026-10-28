import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { type LedgerAccount, type LedgerCategory, loadCashFlow, loadNetWorthTrend, loadTransactionsContext, readReportsParams } from "@fin-creador/api"
import { type IsoDate, monthRange } from "@fin-creador/domain"
import { CashFlowSection } from "@/components/reports/cash-flow"
import { ExportForm } from "@/components/reports/export-form"
import { REPORTS_HEADER, REPORTS_PATH, RangeBar } from "@/components/reports/range-bar"
import { TrendSection } from "@/components/reports/trend"
import { PageHeader } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Reports" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// Reports (Sprint 8c): cash flow per month, the net worth trend and the CSV export, read as the
// signed-in user (RLS). The range lives in the URL (packages/api/src/reports/params.ts); figures
// come from packages/domain through packages/api/src/reports. The trend loads in its own
// Suspense boundary so it never holds up the cash flow.
export default function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<ReportsSkeleton />}>
      <ReportsContent searchParams={searchParams} />
    </Suspense>
  )
}

async function ReportsContent({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams
  const params = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])))
  const query = params.toString()
  const supabase = await createClient()

  const context = await loadTransactionsContext(supabase)
  if (!context.ok && context.reason === "unauthenticated") redirect(`/sign-in?next=${encodeURIComponent(`${REPORTS_PATH}${query ? `?${query}` : ""}`)}`)
  if (!context.ok) return <LoadError />

  const { today, accounts, cardAccounts, categories } = context.data
  const range = readReportsParams(params, today)
  const custom = range.preset === null || params.get("range") === "custom"
  const lastDay = monthRange(range.to).end
  const chartRange = { start: range.from, end: lastDay < today ? lastDay : today }
  const cashFlow = await loadCashFlow(supabase, range.months)

  return (
    <>
      <PageHeader {...REPORTS_HEADER} />
      <RangeBar range={range} today={today} custom={custom} />
      <div className="grid gap-4">
        {cashFlow.ok ? (
          <CashFlowSection data={cashFlow.data} categories={categories} chartRange={chartRange} />
        ) : (
          <FormMessage tone="error">
            We couldn&apos;t load your cash flow. Check your connection.{" "}
            <a href={REPORTS_PATH} className="font-semibold underline underline-offset-4">
              Try again
            </a>
          </FormMessage>
        )}
        <Suspense fallback={<SectionSkeleton label="Loading net worth trend" />}>
          <Trend firstMonth={range.from} />
        </Suspense>
        <ExportForm
          defaultFrom={range.from}
          today={today}
          accounts={[...accounts, ...cardAccounts].map(accountOption)}
          expenseCategories={categories.filter((c) => c.kind === "expense").map(categoryOption)}
          incomeSources={categories.filter((c) => c.kind === "income").map(categoryOption)}
        />
      </div>
    </>
  )
}

const accountOption = (a: LedgerAccount) => ({ id: a.id, label: a.archived ? `${a.label} (archived)` : a.label })
const categoryOption = (c: LedgerCategory) => ({ id: c.id, label: c.archived ? `${c.name} (archived)` : c.name })

async function Trend({ firstMonth }: { firstMonth: IsoDate }) {
  const load = await loadNetWorthTrend(await createClient(), firstMonth)
  return <TrendSection data={load.ok ? load.data : null} />
}

function SectionSkeleton({ label }: { label: string }) {
  return (
    <Card aria-busy="true" aria-label={label} className="grid gap-3">
      <span className="h-6 w-48 rounded bg-canvas" />
      <span className="h-44 w-full rounded-lg bg-canvas" />
    </Card>
  )
}

function ReportsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading reports">
      <PageHeader {...REPORTS_HEADER} />
      <span className="mb-4 block h-12 w-80 max-w-full rounded-xl bg-line/60" />
      <div className="grid gap-4">
        <SectionSkeleton label="Loading cash flow" />
        <SectionSkeleton label="Loading net worth trend" />
      </div>
    </div>
  )
}

function LoadError() {
  return (
    <>
      <PageHeader {...REPORTS_HEADER} />
      <FormMessage tone="error">
        We couldn&apos;t load your reports. Check your connection.{" "}
        <a href={REPORTS_PATH} className="font-semibold underline underline-offset-4">
          Try again
        </a>
      </FormMessage>
    </>
  )
}
