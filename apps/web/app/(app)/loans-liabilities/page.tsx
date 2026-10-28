import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { buildLoansView, loadLoansData } from "@fin-creador/api"
import { LOANS_HEADER, LOANS_PATH } from "@/components/loans/display"
import { LoansPageView, LoansSkeleton } from "@/components/loans/loans-view"
import { PageHeader } from "@/components/shell/app-shell"
import { FormMessage } from "@/components/ui/field"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Loans & Liabilities" }

// Loans & Liabilities (Sprint 8a): loans, their EMI schedules and payments, read as the
// signed-in user (RLS). Figures come from packages/domain through the shared view.
export default function LoansPage({ searchParams }: { searchParams: Promise<{ pay?: string | string[] }> }) {
  return (
    <Suspense fallback={<LoansSkeleton />}>
      <LoansContent searchParams={searchParams} />
    </Suspense>
  )
}

async function LoansContent({ searchParams }: { searchParams: Promise<{ pay?: string | string[] }> }) {
  const { pay } = await searchParams
  const supabase = await createClient()
  const data = await loadLoansData(supabase)
  if (!data.ok && data.reason === "unauthenticated") redirect(`/sign-in?next=${encodeURIComponent(LOANS_PATH)}`)
  if (!data.ok) {
    return (
      <>
        <PageHeader {...LOANS_HEADER} />
        <FormMessage tone="error">
          We couldn&apos;t load your loans. Check your connection.{" "}
          <a href={LOANS_PATH} className="font-semibold underline underline-offset-4">
            Try again
          </a>
        </FormMessage>
      </>
    )
  }
  return <LoansPageView view={buildLoansView(data.data)} payId={typeof pay === "string" ? pay : null} />
}
