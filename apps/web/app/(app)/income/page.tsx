import type { Metadata } from "next"
import { Suspense } from "react"
import { IncomeView } from "@/components/income/income-view"
import { PageHeader } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { loadIncomePage } from "@/lib/income/load"

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
  const result = await loadIncomePage()
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
  return <IncomeView data={result.data} />
}

function IncomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading income">
      <PageHeader eyebrow="Money in" title="Income" description="See where your money comes from and where it is held." />
      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Card key={i} className="grid gap-4">
            <span className="h-4 w-28 rounded bg-canvas" />
            <span className="h-9 w-40 rounded bg-canvas" />
            <span className="h-4 w-32 rounded bg-canvas" />
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.8fr]">
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
