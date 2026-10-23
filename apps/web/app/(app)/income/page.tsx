import type { Metadata } from "next"
import { Suspense } from "react"
import { buildRecurringView, loadRecurringData, loadTransactionsContext } from "@fin-creador/api"
import { IncomeView } from "@/components/income/income-view"
import { UpcomingSection } from "@/components/recurring/upcoming"
import { PageHeader } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { loadIncomePage } from "@/lib/income/load"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Income" }

// Income page (design-spec §9): data loads as the signed-in user (RLS); every figure is
// calculated in packages/domain. No sample data: new users see empty states.
export default function IncomePage() {
  return (
    <Suspense fallback={<IncomeSkeleton />}>
      <IncomeContent />
    </Suspense>
  )
}

async function IncomeContent() {
  const supabase = await createClient()
  const [result, context, recurring] = await Promise.all([loadIncomePage(), loadTransactionsContext(supabase), loadRecurringData(supabase)])
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
  return <IncomeView data={result.data} upcoming={upcoming} />
}

function IncomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading income">
      <PageHeader eyebrow="Money in" title="Income" description="See where your money comes from and where it is held." />
      <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Card key={i} className="grid gap-4">
            <span className="h-4 w-28 rounded bg-canvas" />
            <span className="h-9 w-40 rounded bg-canvas" />
            <span className="h-4 w-32 rounded bg-canvas" />
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.45fr_0.8fr]">
        {[0, 1].map((i) => (
          <Card key={i} className="grid gap-4">
            <span className="h-5 w-40 rounded bg-canvas" />
            {[0, 1, 2].map((j) => (
              <span key={j} className="h-12 w-full rounded-xl bg-canvas" />
            ))}
          </Card>
        ))}
      </div>
    </div>
  )
}
