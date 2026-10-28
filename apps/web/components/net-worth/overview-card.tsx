import Link from "next/link"
import { ChevronRight } from "lucide-react"
import {
  type NetWorth,
  type NetWorthLine,
  type NotIncluded,
  NET_WORTH_FLAG_TEXT,
  NET_WORTH_LINE_LABEL,
  NET_WORTH_PART_LABEL,
} from "@fin-creador/domain"
import { cn } from "cn"
import { fullDate, money } from "@/components/transactions/display"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"

// The Overview's Net worth card (Sprint 8e): assets minus liabilities in the profile currency,
// from netWorth in packages/domain. Every line says what it is valued as of, and every flag
// says why. No month-by-month trend here (8c).

const LINE_HREF: Partial<Record<NetWorthLine["key"], string>> = {
  available: "/income",
  holdings: "/investments",
  deposits: "/investments",
  loans: "/loans-liabilities",
  cards: "/loans-liabilities",
  borrowings: "/loans-liabilities",
  statutory: "/loans-liabilities",
  credit: "/loans-liabilities",
}

function asOfText(line: NetWorthLine, today: string): string {
  if (line.key !== "holdings") return line.asOf.to === today ? "Today" : fullDate(line.asOf.to)
  return line.asOf.from === line.asOf.to ? `Prices of ${fullDate(line.asOf.to)}` : `Prices of ${fullDate(line.asOf.from)} to ${fullDate(line.asOf.to)}`
}

function notIncludedText(item: NotIncluded): string {
  return item.reason === "no_price" ? `${item.name}: not included (no price)` : `${item.name}: not included (${item.currency}, another currency)`
}

function Retry() {
  return (
    <Link href="/" className="font-semibold text-ink underline underline-offset-4">
      Try again
    </Link>
  )
}

function Lines({ title, lines, view }: { title: string; lines: NetWorthLine[]; view: NetWorth }) {
  if (lines.length === 0) return null
  return (
    <div className="grid gap-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul aria-label={title} className="grid text-sm">
        {lines.map((l) => {
          const href = LINE_HREF[l.key]
          return (
            <li key={l.key} className="grid gap-0.5 border-t border-line py-1.5 first:border-t-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                {href ? (
                  <Link href={href} className="text-ink underline-offset-4 hover:underline">
                    {NET_WORTH_LINE_LABEL[l.key]}
                  </Link>
                ) : (
                  <span>{NET_WORTH_LINE_LABEL[l.key]}</span>
                )}
                <span className={cn("font-semibold tabular-nums", l.side === "liability" && "text-danger")}>
                  {l.side === "liability" && <span aria-hidden="true">−</span>}
                  <span className="sr-only">{l.side === "liability" ? "minus " : ""}</span>
                  {money(l.amountMinor, view.currency)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {l.count > 0 && `${l.count} ${l.count === 1 ? "item" : "items"} · `}
                {asOfText(l, view.today)}
              </p>
              {l.flags.length > 0 && (
                <ul aria-label="Notes" className="grid text-xs text-muted-foreground">
                  {l.flags.map((f) => (
                    <li key={f.flag}>
                      {f.count} × {NET_WORTH_FLAG_TEXT[f.flag]}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function NetWorthCard({ view, timeZone }: { view: NetWorth | null; timeZone: string | null }) {
  if (!view) {
    return (
      <Card aria-labelledby="net-worth-title" className="grid content-start gap-2">
        <CardTitle id="net-worth-title">Net worth</CardTitle>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load this. <Retry />
        </p>
      </Card>
    )
  }
  const assets = view.lines.filter((l) => l.side === "asset")
  const liabilities = view.lines.filter((l) => l.side === "liability")
  return (
    <Card aria-labelledby="net-worth-title" className="grid content-start gap-3">
      <div>
        <CardTitle id="net-worth-title">Net worth</CardTitle>
        <CardDescription className="mt-1">
          What you own minus what you owe, as of {fullDate(view.today)}
          {timeZone ? ` (${timeZone} time)` : ""}, in {view.currency}.
        </CardDescription>
      </div>
      {view.empty ? (
        <p className="text-sm text-muted-foreground">
          Add an account, a holding or a loan to see your net worth. <Link href="/income" className="font-semibold text-ink underline underline-offset-4">Add an account</Link>
        </p>
      ) : (
        <>
          {view.totalMinor !== null ? (
            <div className="grid gap-0.5">
              <p className={cn("font-heading text-2xl font-bold tabular-nums", view.totalMinor < 0 && "text-danger")}>
                <span className="sr-only">Net worth </span>
                {money(view.totalMinor, view.currency)}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                Assets {money(view.assetsMinor ?? 0, view.currency)} · Liabilities {money(view.liabilitiesMinor ?? 0, view.currency)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No total until everything loads.</p>
          )}
          {view.failed.length > 0 && (
            <ul aria-label="Not loaded" className="grid gap-1 text-sm">
              {view.failed.map((p) => (
                <li key={p} className="text-danger">
                  Couldn&apos;t load {NET_WORTH_PART_LABEL[p]}. <Retry />
                </li>
              ))}
            </ul>
          )}
          <Lines title="Assets" lines={assets} view={view} />
          <Lines title="Liabilities" lines={liabilities} view={view} />
          {view.notIncluded.length > 0 && (
            <div className="grid gap-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Not included</h3>
              <ul aria-label="Not included" className="grid text-xs text-muted-foreground">
                {view.notIncluded.map((n, i) => (
                  <li key={`${n.name}-${i}`}>{notIncludedText(n)}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <Link href="/loans-liabilities" className="inline-flex items-center gap-1 text-sm font-semibold text-ink underline-offset-4 hover:underline">
        Loans &amp; Liabilities
        <ChevronRight aria-hidden="true" className="size-4" />
      </Link>
    </Card>
  )
}

export function NetWorthSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading net worth" className="grid gap-3">
      <span className="h-5 w-28 rounded bg-canvas" />
      <span className="h-8 w-40 rounded bg-canvas" />
      <span className="h-24 w-full rounded bg-canvas" />
    </Card>
  )
}
