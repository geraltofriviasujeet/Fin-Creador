import Link from "next/link"
import type { Lookup } from "@fin-creador/api"
import { type CategorySpend, type DateRange, addMinor, formatMoney, formatPercentFromBasisPoints, ratioToBasisPoints } from "@fin-creador/domain"
import { transactionsHref } from "@fin-creador/api"
import { cn } from "cn"

// Spending by category as a donut (plain SVG, uniform scale). Slices run clockwise from
// the top in the same order as the legend, which gives each name, amount and share in
// text, so colour is never the only way to tell slices apart. "Everything else" is grey.

const SLICES = ["stroke-chart", "stroke-brand-deep", "stroke-success", "stroke-danger", "stroke-muted-foreground"]
const SWATCHES = ["bg-chart", "bg-brand-deep", "bg-success", "bg-danger", "bg-muted-foreground"]
const REST = { stroke: "stroke-line-strong", swatch: "bg-line-strong" }

/** Circumference 100, so a slice's dash length is its percentage. */
const R = 100 / (2 * Math.PI)

export function CategoryPie({
  categories,
  range,
  currency,
  lookup,
}: {
  categories: CategorySpend[]
  range: DateRange
  currency: string
  lookup: Lookup
}) {
  const total = addMinor(...categories.map((c) => c.expenseMinor))
  const money = (minor: number) => formatMoney(minor, { currency })
  // Each slice's length (percent of the circle) and where it starts, clockwise from the top.
  const lengths = categories.map((c) => (c.expenseMinor / total) * 100)
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0))
  const named = categories.map((c, i) => {
    const category = c.categoryId ? lookup.categories.get(c.categoryId) : undefined
    return {
      ...c,
      label: c.categoryId === null ? "Everything else" : `${category?.name ?? "Category"}${category?.archived ? " (archived)" : ""}`,
      share: ratioToBasisPoints(c.expenseMinor, total) ?? 0,
      stroke: c.categoryId === null ? REST.stroke : SLICES[i % SLICES.length]!,
      swatch: c.categoryId === null ? REST.swatch : SWATCHES[i % SWATCHES.length]!,
      length: lengths[i]!,
      start: starts[i]!,
    }
  })
  // A small gap between slices (none for a single slice); display only.
  const gap = named.length > 1 ? 0.6 : 0

  return (
    <div className="grid items-center gap-5 md:grid-cols-[auto_1fr] lg:grid-cols-1">
      <div className="relative mx-auto size-44">
        <svg viewBox="0 0 40 40" role="img" aria-label={`Spending by category: ${named.map((c) => `${c.label} ${money(c.expenseMinor)}`).join(", ")}.`} className="size-full -rotate-90">
          <circle cx="20" cy="20" r={R} fill="none" strokeWidth="6" className="stroke-canvas" />
          {named.map((c) => {
            const dash = Math.max(c.length - gap, 0.4)
            return (
              <circle
                key={c.categoryId ?? "rest"}
                cx="20"
                cy="20"
                r={R}
                fill="none"
                strokeWidth="6"
                strokeDasharray={`${dash} ${100 - dash}`}
                strokeDashoffset={-c.start}
                className={c.stroke}
              >
                <title>{`${c.label}: ${money(c.expenseMinor)} (${formatPercentFromBasisPoints(c.share)})`}</title>
              </circle>
            )
          })}
        </svg>
        <p aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs text-muted-foreground">Spent</span>
          <span className="font-heading text-lg font-semibold tabular-nums">{money(total)}</span>
        </p>
      </div>
      <ul aria-label="Categories" className="grid gap-2">
        {named.map((c) => {
          const body = (
            <>
              <span aria-hidden="true" className={cn("size-3 shrink-0 rounded-sm", c.swatch)} />
              <span className="min-w-0 flex-1 truncate font-semibold">{c.label}</span>
              <span className="shrink-0 tabular-nums">
                {money(c.expenseMinor)} <span className="text-xs text-muted-foreground">· {formatPercentFromBasisPoints(c.share)}</span>
              </span>
            </>
          )
          return (
            <li key={c.categoryId ?? "rest"}>
              {c.categoryId ? (
                <Link
                  href={transactionsHref(range, { type: "expense", categoryId: c.categoryId })}
                  className="flex min-h-8 items-center gap-2.5 rounded-lg text-sm underline-offset-4 hover:underline"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex min-h-8 items-center gap-2.5 text-sm">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
