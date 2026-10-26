import { type BucketTotals, type DateRange, type IsoDate, bucketSizeFor, formatMoney, partialBucket } from "@fin-creador/domain"
import { fullDate } from "@/components/transactions/display"
import { cn } from "cn"

// Plain SVG bar or line chart over time (design-spec §4, Sprint 5 decisions). The SVG only
// draws marks and stretches to the card; all text (axis labels, legend, notes) is HTML so it never drops
// below 12px. Every chart has a table alternative.

export type Series = "income" | "expense"

export type TimeChartKind = "bar" | "line"

// With two lines, expenses are dashed, so the lines differ by more than colour.
const SERIES: Record<Series, { label: string; bar: string; stroke: string; area: string; swatch: string; border: string }> = {
  income: { label: "Income", bar: "fill-brand-deep", stroke: "stroke-brand-deep", area: "fill-brand-deep/10", swatch: "bg-brand-deep", border: "border-brand-deep" },
  expense: { label: "Expenses", bar: "fill-chart", stroke: "stroke-chart", area: "fill-chart/15", swatch: "bg-chart", border: "border-chart" },
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const value = (b: BucketTotals, s: Series) => (s === "income" ? b.incomeMinor : b.expenseMinor)

/** The smallest 1, 2 or 5 × 10ⁿ at or above `n` (axis top). */
function niceCeil(n: number): number {
  if (n <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(n))
  return ([1, 2, 5, 10].find((m) => m * p >= n) ?? 10) * p
}

function bucketLabel(start: IsoDate, range: DateRange, short: boolean): string {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number]
  if (bucketSizeFor(range) === "day") {
    return short ? `${d} ${MONTHS[m - 1]}` : fullDate(start)
  }
  const multiYear = range.start.slice(0, 4) !== range.end.slice(0, 4)
  return short && !multiYear ? MONTHS[m - 1]! : `${MONTHS[m - 1]} ${y}`
}

function weekdayLabel(start: IsoDate): string {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number]
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`
}

const partialText = (part: DateRange) => {
  const [, m1, d1] = part.start.split("-").map(Number) as [number, number, number]
  const [, , d2] = part.end.split("-").map(Number) as [number, number, number]
  return `${d1}–${d2} ${MONTHS[m1 - 1]} only`
}

export function TimeChart({
  kind,
  buckets,
  range,
  series,
  currency,
  summary,
}: {
  kind: TimeChartKind
  buckets: BucketTotals[]
  range: DateRange
  series: Series[]
  currency: string
  /** One sentence for screen readers, e.g. the highest day. */
  summary: string
}) {
  const n = buckets.length
  const top = niceCeil(Math.max(...buckets.flatMap((b) => series.map((s) => value(b, s)))))
  const money = (minor: number) => formatMoney(minor, { currency })
  const byDay = bucketSizeFor(range) === "day"
  const isWeek = byDay && n === 7
  const every = n <= 7 ? 1 : Math.ceil(n / 6)
  const everyOnPhone = n <= 4 ? every : every * 2
  const partials = buckets.flatMap((b) => {
    const part = partialBucket(b.start, range)
    return part ? [{ start: b.start, part }] : []
  })
  const isPartial = (start: IsoDate) => partials.some((p) => p.start === start)

  // Each bucket is 10 units wide; bars share 7 of them. A line needs at least two points.
  const barWidth = 7 / series.length
  const asLine = kind === "line" && n > 1
  const dashed = (s: Series) => asLine && series.length > 1 && s === "expense"
  const y = (v: number) => 100 - (v / top) * 100

  return (
    <div>
      {series.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legend">
          {series.map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              {asLine ? (
                <span aria-hidden="true" className={cn("w-5 border-t-2", SERIES[s].border, dashed(s) && "border-dashed")} />
              ) : (
                <span aria-hidden="true" className={cn("size-3 rounded-sm", SERIES[s].swatch)} />
              )}
              {SERIES[s].label}
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-x-3">
        <div aria-hidden="true" className="relative h-48 w-16 text-right text-xs text-muted-foreground tabular-nums">
          {[1, 0.5, 0].map((f) => (
            <span key={f} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(1 - f) * 100}%` }}>
              {money(Math.round(top * f))}
            </span>
          ))}
        </div>
        <div className="relative h-48">
          {[0, 0.5, 1].map((f) => (
            <span key={f} aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-line" style={{ top: `${f * 100}%` }} />
          ))}
          <svg
            role="img"
            aria-label={summary}
            viewBox={`0 0 ${n * 10} 100`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            {asLine
              ? series.map((s) => {
                  const points = buckets.map((b, i) => `${i * 10 + 5},${y(value(b, s))}`).join(" ")
                  return (
                    <g key={s}>
                      {series.length === 1 && <polygon points={`5,100 ${points} ${n * 10 - 5},100`} className={SERIES[s].area} />}
                      <polyline
                        points={points}
                        fill="none"
                        strokeWidth={2.5}
                        strokeLinejoin="round"
                        strokeDasharray={dashed(s) ? "7 5" : undefined}
                        vectorEffect="non-scaling-stroke"
                        className={SERIES[s].stroke}
                      />
                    </g>
                  )
                })
              : buckets.map((b, i) =>
                  series.map((s, j) => {
                    const v = value(b, s)
                    if (v <= 0) return null
                    const h = Math.max((v / top) * 100, 0.8)
                    return (
                      <rect key={`${b.start}-${s}`} x={i * 10 + 1.5 + j * barWidth} y={100 - h} width={barWidth * 0.92} height={h} rx={0.6} className={SERIES[s].bar}>
                        <title>{`${bucketLabel(b.start, range, false)}: ${SERIES[s].label.toLowerCase()} ${money(v)}`}</title>
                      </rect>
                    )
                  })
                )}
            {asLine &&
              buckets.map((b, i) => (
                // Invisible hover targets, one per bucket, for the values under the pointer.
                <rect key={`hover-${b.start}`} x={i * 10} y={0} width={10} height={100} fill="transparent">
                  <title>{`${bucketLabel(b.start, range, false)}: ${series.map((s) => `${SERIES[s].label.toLowerCase()} ${money(value(b, s))}`).join(", ")}`}</title>
                </rect>
              ))}
          </svg>
        </div>
        <div aria-hidden="true" />
        <div aria-hidden="true" className="relative mt-2 h-5 text-xs text-muted-foreground">
          {buckets.map((b, i) =>
            i % every === 0 ? (
              <span
                key={b.start}
                // Phones show about half as many labels so they never run together.
                className={cn("absolute -translate-x-1/2 whitespace-nowrap", i % everyOnPhone !== 0 && "hidden md:inline")}
                style={{ left: `${((i + 0.5) / n) * 100}%` }}
              >
                {isWeek ? weekdayLabel(b.start) : bucketLabel(b.start, range, true)}
                {isPartial(b.start) && "*"}
              </span>
            ) : null
          )}
        </div>
      </div>
      {partials.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          * Partial month:{" "}
          {partials.map((p) => `${bucketLabel(p.start, range, false)} (${partialText(p.part)})`).join("; ")}.
        </p>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground underline-offset-4 hover:underline">Show as a table</summary>
        <table className="mt-2 w-full text-left text-sm tabular-nums">
          <caption className="pb-1 text-left text-xs text-muted-foreground">
            {byDay ? "Days" : "Months"} with nothing recorded are left out.
          </caption>
          <thead>
            <tr className="border-b border-line text-xs text-muted-foreground">
              <th scope="col" className="py-1.5 font-semibold">
                {byDay ? "Day" : "Month"}
              </th>
              {series.map((s) => (
                <th key={s} scope="col" className="py-1.5 text-right font-semibold">
                  {SERIES[s].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buckets
              .filter((b) => series.some((s) => value(b, s) > 0))
              .map((b) => {
                const part = partialBucket(b.start, range)
                return (
                  <tr key={b.start} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-1.5 font-normal">
                      {bucketLabel(b.start, range, false)}
                      {part && ` (partial: ${partialText(part)})`}
                    </th>
                    {series.map((s) => (
                      <td key={s} className="py-1.5 text-right">
                        {money(value(b, s))}
                      </td>
                    ))}
                  </tr>
                )
              })}
          </tbody>
        </table>
      </details>
    </div>
  )
}
