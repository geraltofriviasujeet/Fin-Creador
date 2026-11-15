import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { buildGoalsView, loadGoalsData } from "@fin-creador/api"
import { GOALS_HEADER } from "@/components/goals/display"
import { GoalsPageView, GoalsSkeleton } from "@/components/goals/goals-view"
import { PageHeader } from "@/components/shell/app-shell"
import { FormMessage } from "@/components/ui/field"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Goals" }

// Goals page (Sprint 6): planned expenses and monthly budgets, read as the signed-in user
// (RLS). Every figure is computed in packages/domain from the amounts the person entered.
// ?month=YYYY-MM shows the budgets for a later month (this month otherwise).
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function GoalsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<GoalsSkeleton />}>
      <GoalsContent searchParams={searchParams} />
    </Suspense>
  )
}

async function GoalsContent({ searchParams }: { searchParams: SearchParams }) {
  const month = (await searchParams).month
  const supabase = await createClient()
  const data = await loadGoalsData(supabase, typeof month === "string" ? month : undefined)
  if (!data.ok && data.reason === "unauthenticated") redirect("/sign-in?next=%2Fgoals")
  if (!data.ok) {
    return (
      <>
        <PageHeader {...GOALS_HEADER} />
        <FormMessage tone="error">
          We couldn&apos;t load your goals. Check your connection.{" "}
          <a href="/goals" className="font-semibold underline underline-offset-4">
            Try again
          </a>
        </FormMessage>
      </>
    )
  }
  return <GoalsPageView view={buildGoalsView(data.data)} />
}
