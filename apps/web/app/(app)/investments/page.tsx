import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { buildInvestmentsView, loadInvestmentsData } from "@fin-creador/api"
import { INVESTMENTS_HEADER } from "@/components/investments/display"
import { InvestmentsPageView, InvestmentsSkeleton } from "@/components/investments/investments-view"
import { PageHeader } from "@/components/shell/app-shell"
import { FormMessage } from "@/components/ui/field"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Investments" }

// Investments page (Sprint 7): a holdings tracker, read as the signed-in user (RLS). Value and
// profit are computed in packages/domain from the stored units, buy prices and the last
// closing prices (BSE close, AMFI NAV); nothing here is a live price.
export default function InvestmentsPage() {
  return (
    <Suspense fallback={<InvestmentsSkeleton />}>
      <InvestmentsContent />
    </Suspense>
  )
}

async function InvestmentsContent() {
  const supabase = await createClient()
  const data = await loadInvestmentsData(supabase)
  if (!data.ok && data.reason === "unauthenticated") redirect("/sign-in?next=%2Finvestments")
  if (!data.ok) {
    return (
      <>
        <PageHeader {...INVESTMENTS_HEADER} />
        <FormMessage tone="error">
          We couldn&apos;t load your investments. Check your connection.{" "}
          <a href="/investments" className="font-semibold underline underline-offset-4">
            Try again
          </a>
        </FormMessage>
      </>
    )
  }
  return <InvestmentsPageView view={buildInvestmentsView(data.data)} />
}
