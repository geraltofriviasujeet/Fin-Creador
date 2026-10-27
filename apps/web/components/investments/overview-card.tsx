import Link from "next/link"
import { ChevronRight } from "lucide-react"
import type { InvestmentsView } from "@fin-creador/api"
import { money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Card, CardTitle } from "@/components/ui/card"
import { NOT_IN_TOTAL, ProfitText, pricesAsOfText } from "./display"

// The Overview's Investments card (Sprint 7): value and profit at the last closing prices.
// A tracker only: it never adds to Total available.

function OpenInvestments({ children }: { children: React.ReactNode }) {
  return (
    <Link href="/investments" className="inline-flex items-center gap-1 text-sm font-semibold text-ink underline-offset-4 hover:underline">
      {children}
      <ChevronRight aria-hidden="true" className="size-4" />
    </Link>
  )
}

export function InvestmentsOverviewCard({ view }: { view: InvestmentsView | null }) {
  if (!view) {
    return (
      <Card aria-labelledby="investments-title" className="grid content-start gap-2">
        <CardTitle id="investments-title">Investments</CardTitle>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load this. <Link href="/" className="font-semibold text-ink underline underline-offset-4">Try again</Link>
        </p>
      </Card>
    )
  }
  const { totals } = view
  const empty = view.groups.length === 0
  return (
    <Card aria-labelledby="investments-title" className="grid content-start gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle id="investments-title">Investments</CardTitle>
        <Badge tone="neutral">{NOT_IN_TOTAL}</Badge>
      </div>
      {empty ? (
        <p className="text-sm text-muted-foreground">Track shares, ETFs and mutual funds at the last closing price.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="font-heading text-2xl font-bold tabular-nums">
              <span className="sr-only">Current value </span>
              {totals.pricedCount > 0 ? money(totals.valueMinor, "INR") : "—"}
            </p>
            {totals.pricedCount > 0 && <ProfitText minor={totals.profitMinor} bps={totals.profitBps} />}
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            Invested {money(totals.investedMinor, "INR")} · {pricesAsOfText(view.pricesAsOf)}
            {totals.unpricedCount > 0 && ` · ${totals.unpricedCount} without a current price`}
          </p>
        </>
      )}
      <OpenInvestments>{empty ? "Add a holding" : `View all (${view.groups.length})`}</OpenInvestments>
    </Card>
  )
}
