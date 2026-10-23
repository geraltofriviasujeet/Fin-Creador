import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { buildRecurringView, loadRecurringData, loadTransactionsContext } from "@fin-creador/api"
import { RECURRING_HEADER, RecurringPageView, RecurringSkeleton } from "@/components/recurring/recurring-view"
import { PageHeader } from "@/components/shell/app-shell"
import { FormMessage } from "@/components/ui/field"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Recurring" }

// Recurring page (Sprint 4): rules, what is due, and the estimated recurring cost, read as
// the signed-in user (RLS). Due dates and costs are computed in packages/domain.
export default function RecurringPage() {
  return (
    <Suspense fallback={<RecurringSkeleton />}>
      <RecurringContent />
    </Suspense>
  )
}

async function RecurringContent() {
  const supabase = await createClient()
  const [context, recurring] = await Promise.all([loadTransactionsContext(supabase), loadRecurringData(supabase)])
  if (!context.ok && context.reason === "unauthenticated") redirect("/sign-in?next=%2Frecurring")
  if (!context.ok || !recurring.ok) {
    return (
      <>
        <PageHeader {...RECURRING_HEADER} />
        <FormMessage tone="error">
          We couldn&apos;t load your recurring items. Check your connection.{" "}
          <a href="/recurring" className="font-semibold underline underline-offset-4">
            Try again
          </a>
        </FormMessage>
      </>
    )
  }
  const { accounts, categories, today, currency } = context.data
  const view = buildRecurringView({ ...recurring.data, accounts, categories, today, currency })
  return <RecurringPageView context={context.data} view={view} />
}
