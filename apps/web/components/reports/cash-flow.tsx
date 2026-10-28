import Link from "next/link"
import { type CashFlowData, type LedgerCategory, transactionsHref } from "@fin-creador/api"
import { type CategorySpend, type DateRange, formatMoney, formatPercentFromBasisPoints, ratioToBasisPoints } from "@fin-creador/domain"
import { cn } from "cn"
import { TimeChart } from "@/components/dashboard/time-chart"
import { money, rangeText } from "@/components/transactions/display"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { monthLabel } from "./range-bar"

// Cash flow per calendar month (Sprint 8c), from loadCashFlow: the Overview's own reader per
// month, so a month here equals that month on the Overview. Figures from packages/domain.

const rate = (bps: number | null) => (bps === null ? "—" : formatPercentFromBasisPoints(bps))

function categoryLabel(c: CategorySpend, names: Map<string, LedgerCategory>): string {
  if (c.categoryId === null) return "Everything else"
  const category = names.get(c.categoryId)
  return `${category?.name ?? "Category"}${category?.archived ? " (archived)" : ""}`
}

function Signed({ minor, currency }: { minor: number; currency: string }) {
  return <span className={cn("tabular-nums", minor < 0 && "text-danger")}>{formatMoney(minor, { currency, signed: true })}</span>
}

export function CashFlowSection({ data, categories, chartRange }: { data: CashFlowData; categories: LedgerCategory[]; chartRange: DateRange }) {
  const { report, currency } = data
  const names = new Map(categories.map((c) => [c.id, c]))
  const empty = report.rows.every((r) => r.incomeMinor === 0 && r.expenseMinor === 0)
  const newestFirst = [...report.rows].reverse()
  const { totals } = report

  return (
    <Card aria-labelledby="cash-flow-title" className="grid gap-4">
      <div>
        <CardTitle id="cash-flow-title">Cash flow</CardTitle>
        <CardDescription className="mt-1">
          Income and expenses per month in {currency}, {rangeText(chartRange)}. Transfers between your accounts, including what you repay on loans, cards and
          borrowing, aren&apos;t income or expenses; voided entries never count.
          {data.otherCurrencies.length > 0 && ` Entries in other currencies (${data.otherCurrencies.join(", ")}) aren’t included.`}
        </CardDescription>
      </div>

      {empty ? (
        <p className="rounded-xl bg-canvas px-4 py-6 text-center text-sm text-muted-foreground">
          No income or expenses recorded in these months.{" "}
          <Link href="/transactions?add=expense" className="font-semibold text-ink underline underline-offset-4">
            Add an expense
          </Link>
        </p>
      ) : (
        <>
          <dl aria-label="Totals for the range" className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            {[
              { label: "Income", value: money(totals.incomeMinor, currency) },
              { label: "Expenses", value: money(totals.expenseMinor, currency) },
              { label: "Net", value: <Signed minor={totals.netMinor} currency={currency} /> },
              { label: "Savings rate", value: rate(totals.savingsRateBps) },
            ].map((t) => (
              <div key={t.label} className="rounded-xl bg-canvas px-3 py-2">
                <dt className="text-xs text-muted-foreground">{t.label}</dt>
                <dd className="font-heading text-lg font-semibold tabular-nums">{t.value}</dd>
              </div>
            ))}
          </dl>

          <TimeChart
            kind="bar"
            size="month"
            buckets={report.rows.map((r) => ({ start: r.month, incomeMinor: r.incomeMinor, expenseMinor: r.expenseMinor }))}
            range={chartRange}
            series={["income", "expense"]}
            currency={currency}
            summary={`Income and expenses per month, ${rangeText(chartRange)}: income ${money(totals.incomeMinor, currency)}, expenses ${money(totals.expenseMinor, currency)}.`}
          />

          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm tabular-nums">
              <caption className="pb-2 text-left text-xs text-muted-foreground">Newest month first. Each month opens its entries on Transactions.</caption>
              <thead>
                <tr className="border-b border-line text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 font-semibold">Month</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">Income</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">Expenses</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">Net</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">Savings rate</th>
                  <th scope="col" className="py-1.5 pl-4 font-semibold">Largest category</th>
                </tr>
              </thead>
              <tbody>
                {newestFirst.map((r) => (
                  <tr key={r.month} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-2 font-normal">
                      <Link href={transactionsHref(r.range)} className="font-semibold text-ink underline-offset-4 hover:underline">
                        {monthLabel(r.month)}
                      </Link>
                      {r.soFar && <span className="ml-1.5 text-xs text-muted-foreground">so far</span>}
                    </th>
                    <td className="py-2 text-right">{money(r.incomeMinor, currency)}</td>
                    <td className="py-2 text-right">{money(r.expenseMinor, currency)}</td>
                    <td className="py-2 text-right">
                      <Signed minor={r.netMinor} currency={currency} />
                    </td>
                    <td className="py-2 text-right">{rate(r.savingsRateBps)}</td>
                    <td className="py-2 pl-4">
                      {r.topCategory ? (
                        <>
                          {categoryLabel(r.topCategory, names)} <span className="text-muted-foreground">{money(r.topCategory.expenseMinor, currency)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.topCategories.length > 0 && (
            <div className="grid gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Top categories for the range</h3>
              <ol aria-label="Top categories for the range" className="grid gap-1.5 text-sm">
                {report.topCategories.map((c) => {
                  const share = ratioToBasisPoints(c.expenseMinor, totals.expenseMinor) ?? 0
                  return (
                    <li key={c.categoryId ?? "rest"} className="grid gap-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span>{categoryLabel(c, names)}</span>
                        <span className="tabular-nums">
                          {money(c.expenseMinor, currency)} <span className="text-xs text-muted-foreground">{formatPercentFromBasisPoints(share)}</span>
                        </span>
                      </div>
                      <span aria-hidden="true" className="h-1.5 rounded-full bg-canvas">
                        <span className={cn("block h-full rounded-full", c.categoryId === null ? "bg-line-strong" : "bg-chart")} style={{ width: `${share / 100}%` }} />
                      </span>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
