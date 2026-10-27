import Link from "next/link"
import { ChevronRight } from "lucide-react"
import type { InvestmentsView } from "@fin-creador/api"
import { money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Card, CardTitle } from "@/components/ui/card"
import { CATEGORY_LABEL, NOT_IN_TOTAL, ProfitText, pricesAsOfText } from "./display"

// The Overview's Investments card (Sprint 7): value and profit at the last closing prices, and
// fixed deposits valued today. A tracker only: it never adds to Total available.

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
  const empty = view.groups.length === 0 && view.deposits.length === 0
  return (
    <Card aria-labelledby="investments-title" className="grid content-start gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle id="investments-title">Investments</CardTitle>
        <Badge tone="neutral">{NOT_IN_TOTAL}</Badge>
      </div>
      {empty ? (
        <p className="text-sm text-muted-foreground">Track shares, ETFs and mutual funds at the last closing price, and fixed deposits.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="font-heading text-2xl font-bold tabular-nums">
              <span className="sr-only">Current value </span>
              {money(totals.valueMinor, "INR")}
            </p>
            <ProfitText minor={totals.profitMinor} bps={totals.profitBps} />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            Invested {money(totals.investedMinor, "INR")}
            {view.pricesAsOf && ` · ${pricesAsOfText(view.pricesAsOf)}`}
            {view.deposits.length > 0 && " · Deposits valued today"}
          </p>
          <ul aria-label="By category" className="grid border-t border-line pt-1.5 text-sm">
            {view.categories.map((c) => (
              <li key={c.category} className="flex flex-wrap items-baseline justify-between gap-x-3 py-0.5">
                <span className="text-muted-foreground">{CATEGORY_LABEL[c.category]}</span>
                {c.count === 0 ? (
                  <span className="text-xs text-muted-foreground">None</span>
                ) : (
                  <span className="flex items-baseline gap-2 tabular-nums">
                    <span className="font-semibold">{money(c.totals.valueMinor, "INR")}</span>
                    <ProfitText minor={c.totals.profitMinor} bps={c.totals.profitBps} className="text-xs" />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <OpenInvestments>{empty ? "Add a holding" : `View all (${view.groups.length + view.deposits.length})`}</OpenInvestments>
    </Card>
  )
}
