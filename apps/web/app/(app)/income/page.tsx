import type { Metadata } from "next"
import { Suspense } from "react"
import { buildRecurringView, loadRecurringData, loadTransactionsContext } from "@fin-creador/api"
import { isInRange, minDate, previousMonthRange, yearRange } from "@fin-creador/domain"
import { IncomeView } from "@/components/income/income-view"
import { UpcomingSection } from "@/components/recurring/upcoming"
import { PageHeader } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { loadIncomePage } from "@/lib/income/load"
import { buildIncomePageView } from "@/lib/income/view"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Income" }

// Income page (design-spec §9): data loads as the signed-in user (RLS); every figure is
// calculated on the server with packages/domain (lib/income/view.ts). No sample data: new
// users see empty states. ?period=all loads every income entry for the All time view; other
// views load only this year and last month.
export default function IncomePage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  return (
    <Suspense fallback={<IncomeSkeleton />}>
      <IncomeContent searchParams={searchParams} />
    </Suspense>
  )
}

async function IncomeContent({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const { period } = await searchParams
  const allTime = period === "all"
  const supabase = await createClient()
  const [result, context, recurring] = await Promise.all([loadIncomePage({ allTime }), loadTransactionsContext(supabase), loadRecurringData(supabase)])
  if (!result.ok) {
    return (
      <>
        <PageHeader eyebrow="Money in" title="Income" description="See where your money comes from and where it is held." />
        <FormMessage tone="error">
          We couldn’t load your income and accounts. <a href="/income" className="font-semibold underline underline-offset-4">Try again</a>
        </FormMessage>
      </>
    )
  }
  // The Upcoming card is optional here: if it can't load, the Income page still shows.
  const upcoming =
    context.ok && recurring.ok ? (
      <UpcomingSection
        view={buildRecurringView({ ...recurring.data, ...context.data })}
        accounts={context.data.accounts}
        categories={context.data.categories}
        today={context.data.today}
        currency={context.data.currency}
        type="income"
      />
    ) : null
  // Without the rules, sources show totals only (no rate is ever guessed).
  const view = buildIncomePageView(result.data, recurring.ok ? recurring.data.rules : [], { allTime })
  // The browser gets only the entries its dialogs list (this year), not the whole history.
  const { today } = result.data
  const since = minDate(yearRange(today).start, previousMonthRange(today).start)
  const data = allTime ? { ...result.data, entries: result.data.entries.filter((e) => isInRange(e.occurredOn, { start: since, end: today })) } : result.data
  return <IncomeView data={data} view={view} initialPeriod={allTime ? "all" : period === "year" ? "year" : "month"} upcoming={upcoming} />
}

function IncomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading income">
      <PageHeader eyebrow="Money in" title="Income" description="See where your money comes from and where it is held." />
      <div className="grid gap-4">
        {[0, 1].map((i) => (
          <Card key={i} className="grid gap-4">
            <span className="h-5 w-40 rounded bg-canvas" />
            {[0, 1, 2].map((j) => (
              <span key={j} className="h-6 w-full rounded bg-canvas" />
            ))}
            {[0, 1, 2].map((j) => (
              <span key={j} className="h-10 w-full rounded-xl bg-canvas" />
            ))}
          </Card>
        ))}
      </div>
    </div>
  )
}
