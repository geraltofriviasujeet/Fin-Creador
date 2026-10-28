import Link from "next/link"
import type { TrendData } from "@fin-creador/api"
import { type SeriesPoint, formatMoney } from "@fin-creador/domain"
import { cn } from "cn"
import { fullDate, money } from "@/components/transactions/display"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { REPORTS_PATH, monthLabel } from "./range-bar"

// Net worth trend (Sprint 8c): a point at each month-end in the profile time zone and the last
// one today, from netWorthSeries in packages/domain. Shares, funds and ETFs are left out of
// every point (only today's price is kept); today's net worth with them sits beside the chart,
// so the last point plus investments equals the Overview card. Text is HTML (never below 12px);
// the SVG only draws, and a table says the same.

export const TREND_EXCLUDES = "Excluding shares, funds & ETFs (only today’s price is kept)"

const total = (p: SeriesPoint) => p.worth.totalMinor ?? 0

/** The smallest 1, 2 or 5 × 10ⁿ at or above `n`. */
function niceCeil(n: number): number {
  if (n <= 0) return 0
  const p = 10 ** Math.floor(Math.log10(n))
  return ([1, 2, 5, 10].find((m) => m * p >= n) ?? 10) * p
}

const pointLabel = (p: SeriesPoint, short: boolean) => (p.isToday ? "Today" : short ? monthLabel(p.date) : fullDate(p.date))

function TrendChart({ points, currency }: { points: SeriesPoint[]; currency: string }) {
  const values = points.map(total)
  const hi = niceCeil(Math.max(0, ...values))
  const lo = -niceCeil(-Math.min(0, ...values))
  const span = hi - lo || 1
  const n = points.length
  const y = (v: number) => ((hi - v) / span) * 100
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100)
  const every = n <= 7 ? 1 : Math.ceil(n / 6)
  const ticks = lo < 0 ? [hi, 0, lo] : [hi, hi / 2, 0]
  const fmt = (minor: number) => formatMoney(minor, { currency })
  const last = points[n - 1]!

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3">
      <div aria-hidden="true" className="relative h-44 w-16 text-right text-xs text-muted-foreground tabular-nums">
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${y(t)}%` }}>
            {fmt(Math.round(t))}
          </span>
        ))}
      </div>
      <div className="relative h-44">
        {ticks.map((t) => (
          <span key={t} aria-hidden="true" className={cn("absolute inset-x-0 border-t border-line", t !== 0 && "border-dashed")} style={{ top: `${y(t)}%` }} />
        ))}
        <svg
          role="img"
          aria-label={`Net worth ${TREND_EXCLUDES.toLowerCase()}: ${fmt(total(points[0]!))} on ${pointLabel(points[0]!, false)}, ${fmt(total(last))} today.`}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          {n > 1 && (
            <polyline
              points={points.map((p, i) => `${x(i)},${y(total(p))}`).join(" ")}
              fill="none"
              strokeWidth={2.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-brand-deep"
            />
          )}
        </svg>
        {/* Dots in HTML so they stay round (the SVG stretches to the card). */}
        {points.map((p, i) => (
          <span
            key={p.date}
            aria-hidden="true"
            title={`${pointLabel(p, false)}: ${fmt(total(p))}`}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-deep",
              p.isToday ? "size-3 bg-brand-deep" : "size-2 bg-surface"
            )}
            style={{ left: `${x(i)}%`, top: `${y(total(p))}%` }}
          />
        ))}
      </div>
      <div aria-hidden="true" />
      <div aria-hidden="true" className="relative mt-2 h-5 text-xs text-muted-foreground">
        {points.map((p, i) =>
          i % every === 0 || i === n - 1 ? (
            <span
              key={p.date}
              className={cn(
                "absolute whitespace-nowrap",
                n === 1 ? "-translate-x-1/2" : i === n - 1 ? "-translate-x-full" : i === 0 ? "" : "-translate-x-1/2",
                // Phones keep the first and last labels only past six points, so none run together.
                n > 6 && i !== 0 && i !== n - 1 && "hidden md:inline",
                // The label before "Today" can collide with it.
                i !== n - 1 && n - 1 - i < every && "hidden"
              )}
              style={{ left: `${x(i)}%` }}
            >
              {pointLabel(p, true)}
            </span>
          ) : null
        )}
      </div>
    </div>
  )
}

export function TrendSection({ data }: { data: TrendData | null }) {
  if (!data) {
    return (
      <Card aria-labelledby="trend-title" className="grid gap-2">
        <CardTitle id="trend-title">Net worth trend</CardTitle>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load your net worth trend.{" "}
          <Link href={REPORTS_PATH} className="font-semibold text-ink underline underline-offset-4">
            Try again
          </Link>
        </p>
      </Card>
    )
  }
  const { points, currency, current } = data
  const last = points.at(-1)
  const holdings = current?.lines.find((l) => l.key === "holdings")?.amountMinor ?? 0
  const otherCurrency = last?.worth.notIncluded.length ?? 0

  return (
    <Card aria-labelledby="trend-title" className="grid gap-4">
      <div>
        <CardTitle id="trend-title">Net worth trend</CardTitle>
        <CardDescription className="mt-1">
          What you owned minus what you owed at the end of each month ({data.timeZone} time) and today, in {currency}.
        </CardDescription>
      </div>

      {!last ? (
        <p className="rounded-xl bg-canvas px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing to show yet. Add an account, a fixed deposit or a loan to see your net worth over time.{" "}
          <Link href="/income" className="font-semibold text-ink underline underline-offset-4">
            Add an account
          </Link>
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-[1fr_15rem] md:items-start">
            <figure className="grid gap-2">
              <figcaption className="text-xs font-semibold text-muted-foreground">{TREND_EXCLUDES}</figcaption>
              <TrendChart points={points} currency={currency} />
            </figure>
            <dl aria-label="Today with investments" className="grid gap-2 rounded-xl bg-canvas p-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Today, excluding shares, funds &amp; ETFs</dt>
                <dd className={cn("font-semibold tabular-nums", total(last) < 0 && "text-danger")}>{money(total(last), currency)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Shares, funds &amp; ETFs today</dt>
                <dd className="font-semibold tabular-nums">{current ? money(holdings, currency) : "—"}</dd>
              </div>
              <div className="border-t border-line pt-2">
                <dt className="text-xs text-muted-foreground">Net worth today, with investments</dt>
                <dd className={cn("font-heading text-xl font-bold tabular-nums", (current?.totalMinor ?? 0) < 0 && "text-danger")}>
                  {current && current.totalMinor !== null ? (
                    money(current.totalMinor, currency)
                  ) : (
                    <span className="text-sm font-normal text-muted-foreground">
                      Couldn&apos;t load.{" "}
                      <Link href={REPORTS_PATH} className="font-semibold text-ink underline underline-offset-4">
                        Try again
                      </Link>
                    </span>
                  )}
                </dd>
              </div>
              <p className="text-xs text-muted-foreground">
                As on the{" "}
                <Link href="/" className="font-semibold text-ink underline underline-offset-4">
                  Overview
                </Link>
                .
              </p>
            </dl>
          </div>

          <ul aria-label="Notes" className="grid list-disc gap-1 pl-4 text-xs text-muted-foreground">
            <li>As corrected: past balances use your entries as they are now; voided entries never count.</li>
            <li>Statutory dues use today&apos;s amount, from the day each was added.</li>
            <li>Fixed deposits are valued by their rate from the start date; loans and cards at what was owed then.</li>
            {otherCurrency > 0 && <li>{otherCurrency} {otherCurrency === 1 ? "item" : "items"} in other currencies aren&apos;t included.</li>}
          </ul>

          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground underline-offset-4 hover:underline">Show as a table</summary>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[28rem] text-left text-sm tabular-nums">
                <caption className="pb-1 text-left text-xs text-muted-foreground">{TREND_EXCLUDES}.</caption>
                <thead>
                  <tr className="border-b border-line text-xs text-muted-foreground">
                    <th scope="col" className="py-1.5 font-semibold">Date</th>
                    <th scope="col" className="py-1.5 text-right font-semibold">Assets</th>
                    <th scope="col" className="py-1.5 text-right font-semibold">Liabilities</th>
                    <th scope="col" className="py-1.5 text-right font-semibold">Net worth</th>
                  </tr>
                </thead>
                <tbody>
                  {[...points].reverse().map((p) => (
                    <tr key={p.date} className="border-b border-line last:border-b-0">
                      <th scope="row" className="py-1.5 font-normal">
                        {p.isToday ? `Today, ${fullDate(p.date)}` : fullDate(p.date)}
                      </th>
                      <td className="py-1.5 text-right">{money(p.worth.assetsMinor ?? 0, currency)}</td>
                      <td className="py-1.5 text-right">{money(p.worth.liabilitiesMinor ?? 0, currency)}</td>
                      <td className={cn("py-1.5 text-right font-semibold", total(p) < 0 && "text-danger")}>{money(total(p), currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Card>
  )
}
