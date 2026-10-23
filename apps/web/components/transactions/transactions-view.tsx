"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Menu } from "@base-ui/react/menu"
import { Ellipsis, Plus, Search, X } from "lucide-react"
import { type LedgerItem, type PageCursor, type TransactionTotals, type TransactionsContext, type Filters, type Lookup, PERIODS, TYPE_TABS, filtersToQuery, groupByDay, hasActiveFilters, periodLabel, readFilters, toApiFilters } from "@fin-creador/api"
import {
  type DateRange,
  formatPercentFromBasisPoints,
  incomeTrendBasisPoints,
  savingsRateBasisPoints,
} from "@fin-creador/domain"
import { cn } from "cn"
import { loadMoreTransactionsAction } from "@/app/(app)/transactions/actions"
import { StatCard } from "@/components/income/stat-card"
import { PageHeader } from "@/components/shell/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { EntryIcon, accountChipText, dayHeading, entryKindLabel, entryTitle, money, rangeText, signedAmount } from "./display"
import { AddEntryDialog, EditEntryDialog, HistoryDialog, VoidEntryDialog } from "./entry-modals"
import type { EntryType } from "./transaction-form"

export const TRANSACTIONS_HEADER = {
  eyebrow: "Money activity",
  title: "Transactions",
  description: "See every rupee coming in and going out.",
}

export type TransactionsViewProps = {
  context: TransactionsContext
  filters: Filters
  range: DateRange
  first: { items: LedgerItem[]; nextCursor: PageCursor | null }
  totals: TransactionTotals
  prevTotals: TransactionTotals | null
  /** Opened from a link (Edit or History on the Income page). */
  open: { kind: "edit" | "history"; entry: LedgerItem } | null
}

export function TransactionsView({ context, filters: loaded, range, first, totals, prevTotals, open }: TransactionsViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [navigating, startNavigation] = useTransition()
  const { today, currency } = context

  // Later pages, appended to the first page the server rendered. A new first page (filters
  // changed, or a save refreshed the page) starts again.
  const [pages, setPages] = useState({ first, items: first.items, nextCursor: first.nextCursor })
  if (pages.first !== first) setPages({ first, items: first.items, nextCursor: first.nextCursor })
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)

  const [editing, setEditing] = useState<LedgerItem | null>(open?.kind === "edit" ? open.entry : null)
  const [voiding, setVoiding] = useState<LedgerItem | null>(null)
  const [historyOf, setHistoryOf] = useState<LedgerItem | null>(open?.kind === "history" ? open.entry : null)

  // Filter controls show the new choice at once while the page reloads for it (a new
  // filter set remounts this view, which clears the choice).
  const [chosen, setChosen] = useState<Partial<Filters>>({})
  const f: Filters = { ...loaded, ...chosen }
  const href = (next: Partial<Filters>, more: Record<string, string> = {}) => `${pathname}${filtersToQuery({ ...f, ...next }, more)}`
  // Filters reload the page from the server; the URL keeps links and the back button working.
  const go = (next: Partial<Filters>) => {
    setChosen((c) => ({ ...c, ...next }))
    startNavigation(() => router.replace(href(next), { scroll: false }))
  }
  // Opening and closing the Add dialog only changes the URL (no reload).
  const replaceUrl = (url: string) => window.history.replaceState(null, "", url)
  const addParam = params.get("add")
  const addType: EntryType | null = addParam === "expense" || addParam === "income" || addParam === "transfer" ? addParam : null
  const closeAdd = () => replaceUrl(href({}))
  // Deep links (?edit= / ?history=) are dropped from the URL once their dialog closes.
  const closeDeepLink = () => (params.get("edit") || params.get("history")) && replaceUrl(href({}))

  const lookup: Lookup = useMemo(
    () => ({
      accounts: new Map(context.accounts.map((a) => [a.id, a])),
      categories: new Map(context.categories.map((c) => [c.id, c])),
    }),
    [context.accounts, context.categories]
  )

  async function loadMore() {
    if (!pages.nextCursor || loadingMore) return
    setLoadingMore(true)
    setMoreError(false)
    try {
      const next = await loadMoreTransactionsAction({ filters: toApiFilters(loaded, range), currency, cursor: pages.nextCursor })
      if (next.ok) setPages((p) => ({ ...p, items: [...p.items, ...next.items], nextCursor: next.nextCursor }))
      else setMoreError(true)
    } catch {
      setMoreError(true)
    }
    setLoadingMore(false)
  }

  const rows = pages.items
  const groups = groupByDay(rows)
  const incomeTrend = prevTotals ? incomeTrendBasisPoints(totals.incomeMinor, prevTotals.incomeMinor) : null
  const savingsRate = savingsRateBasisPoints(totals)
  // Text about the rows shown follows the loaded filters, not a choice still loading.
  const label = periodLabel(loaded)
  const tabLabel = TYPE_TABS.find((t) => t.value === loaded.type)?.label ?? "All"
  const clearHref = `${pathname}${filtersToQuery(readFilters(new URLSearchParams(), today))}`
  // The exact number of rows, when the totals give it (they never count voided entries,
  // and count other currencies only overall).
  const typeCount = { all: totals.incomeCount + totals.expenseCount + totals.transferCount + totals.otherCurrencyCount, income: totals.incomeCount, expense: totals.expenseCount, transfer: totals.transferCount }[loaded.type]
  const exactCount = !loaded.showVoided && (loaded.type === "all" || totals.otherCurrencyCount === 0) ? typeCount : null
  const formProps = { accounts: context.accounts, categories: context.categories, today }

  const addLink = (type: EntryType, text: string, variant: "primary" | "secondary" = "primary") => (
    <Link href={href({}, { add: type })} scroll={false} className={cn(buttonVariants({ variant, size: "lg" }))}>
      <Plus aria-hidden="true" />
      {text}
    </Link>
  )

  return (
    <>
      <PageHeader {...TRANSACTIONS_HEADER} actions={addLink("expense", "Add transaction")} />

      <nav aria-label="Transaction type" className="mb-4">
        <ul className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface p-1 md:inline-flex">
          {TYPE_TABS.map((t) => {
            const active = t.value === f.type
            return (
              <li key={t.value}>
                <Link
                  href={href({ type: t.value })}
                  replace
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-11 items-center justify-center rounded-lg px-2 text-sm md:min-w-24 md:px-4 font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring",
                    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-ink"
                  )}
                >
                  {t.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <Card className="mb-6 grid gap-4">
        <form
          role="search"
          className="relative"
          onSubmit={(event) => {
            event.preventDefault()
            const q = new FormData(event.currentTarget).get("q")
            go({ q: typeof q === "string" ? q.trim().slice(0, 100) : "" })
          }}
        >
          <label htmlFor="tx-search" className="sr-only">
            Search transactions
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-subtle" />
          <input
            key={f.q}
            id="tx-search"
            name="q"
            type="search"
            defaultValue={f.q}
            maxLength={100}
            placeholder="Note, category, account or amount"
            className="h-11 w-full rounded-lg border border-line-strong bg-surface pr-24 pl-10 text-sm text-ink outline-none placeholder:text-muted-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          />
          <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1">
            {f.q && (
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear search" onClick={() => go({ q: "" })}>
                <X aria-hidden="true" />
              </Button>
            )}
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </div>
        </form>

        <div className="grid items-start gap-4 md:grid-cols-3">
          <SelectField name="period" label="Date" value={f.period} onChange={(e) => go({ period: e.target.value as Filters["period"] })}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </SelectField>
          <SelectField name="category" label="Category" value={f.category} onChange={(e) => go({ category: e.target.value })}>
            <option value="">All categories</option>
            {(["expense", "income"] as const).map((kind) => (
              <optgroup key={kind} label={kind === "expense" ? "Expense categories" : "Income sources"}>
                {context.categories
                  .filter((c) => c.kind === kind)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.archived ? " (archived)" : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </SelectField>
          <SelectField name="account" label="Account" value={f.account} onChange={(e) => go({ account: e.target.value })}>
            <option value="">All accounts</option>
            {context.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
                {a.archived ? " (archived)" : ""}
              </option>
            ))}
          </SelectField>
        </div>

        {f.period === "custom" && (
          <div className="grid gap-4 md:grid-cols-3">
            <TextField name="from" type="date" label="From" max={today} value={f.from} onChange={(e) => e.target.value && go({ from: e.target.value })} />
            <TextField name="to" type="date" label="To" max={today} value={f.to} onChange={(e) => e.target.value && go({ to: e.target.value })} />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex min-h-11 items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={f.showVoided}
              onChange={(e) => go({ showVoided: e.target.checked })}
              className="size-4.5 accent-(--color-primary)"
            />
            Show voided entries
          </label>
          {hasActiveFilters(f) && (
            <Link href={clearHref} replace scroll={false} className="text-sm font-semibold underline underline-offset-4">
              Clear filters
            </Link>
          )}
        </div>
      </Card>

      <div aria-busy={navigating} className={cn("transition-opacity motion-reduce:transition-none", navigating && "opacity-60")}>
        <section aria-label="Totals for these filters" className="mb-2 grid gap-4 md:grid-cols-2 lg:grid-cols-3 md:[&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
          <StatCard
            label={`Income · ${label}`}
            value={money(totals.incomeMinor, currency)}
            footer={
              incomeTrend === null ? (
                `${totals.incomeCount} ${totals.incomeCount === 1 ? "entry" : "entries"}`
              ) : (
                <span className={incomeTrend >= 0 ? "text-success" : "text-danger"}>
                  {formatPercentFromBasisPoints(incomeTrend, { signed: true })} from the month before
                </span>
              )
            }
          />
          <StatCard
            label={`Expenses · ${label}`}
            value={money(totals.expenseMinor, currency)}
            footer={`${totals.expenseCount} ${totals.expenseCount === 1 ? "expense" : "expenses"}`}
          />
          <StatCard
            label="Net savings"
            value={money(totals.netMinor, currency)}
            footer={
              savingsRate === null ? (
                "No income in this period"
              ) : totals.netMinor < 0 ? (
                <span className="text-danger">Spent {money(-totals.netMinor, currency)} more than came in</span>
              ) : (
                <span className="text-success">{formatPercentFromBasisPoints(savingsRate)} savings rate</span>
              )
            }
          />
        </section>
        <p className="mb-6 text-xs text-muted-foreground">
          {rangeText(range)}. Transfers between your accounts ({totals.transferCount}) aren&apos;t income or expenses. Voided entries never count.
          {totals.otherCurrencyCount > 0 && ` ${totals.otherCurrencyCount} entries in other currencies are listed but not totalled.`}
        </p>

        <Card className="px-0 md:px-0">
          <div className="flex flex-wrap items-end justify-between gap-2 px-5 md:px-6">
            <div>
              <CardTitle>{loaded.type === "all" ? "All transactions" : tabLabel}</CardTitle>
              <CardDescription className="mt-1">
                {label}
                {exactCount !== null && ` · ${exactCount} ${exactCount === 1 ? "entry" : "entries"}`}
                {loaded.q && ` matching “${loaded.q}”`}
              </CardDescription>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="grid justify-items-center gap-3 px-5 py-12 text-center md:px-6">
              {!context.hasEntries ? (
                <>
                  <p className="font-heading text-xl font-semibold">No transactions yet</p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    {context.accounts.some((a) => !a.archived)
                      ? "Add what you spend and receive. Transfers between your own accounts go here too, without counting as income or expenses."
                      : "Add an account on the Income page first, then record what you spend and receive here."}
                  </p>
                  <div className="mt-2 flex flex-wrap justify-center gap-3">
                    {context.accounts.some((a) => !a.archived) ? (
                      <>
                        {addLink("expense", "Add expense")}
                        {addLink("income", "Add income", "secondary")}
                      </>
                    ) : (
                      <Link href="/income" className={cn(buttonVariants({ size: "lg" }))}>
                        Go to Income
                      </Link>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="font-heading text-xl font-semibold">Nothing matches these filters</p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    {loaded.q ? "Search looks in notes, category and account names, and exact amounts. " : ""}Try another period or clear the filters.
                  </p>
                  <Link href={clearHref} replace scroll={false} className={cn(buttonVariants({ variant: "secondary" }))}>
                    Clear filters
                  </Link>
                </>
              )}
            </div>
          ) : (
            <div className="mt-4">
              {groups.map((g) => (
                <section key={g.date} aria-labelledby={`day-${g.date}`}>
                  <h3 id={`day-${g.date}`} className="border-y border-line bg-canvas px-5 py-2 text-xs font-semibold tracking-(--fc-tracking-eyebrow) text-muted-foreground uppercase md:px-6">
                    {dayHeading(g.date, today)}
                  </h3>
                  <ul>
                    {g.rows.map((entry) => (
                      <Row
                        key={entry.id}
                        entry={entry}
                        lookup={lookup}
                        onEdit={() => setEditing(entry)}
                        onVoid={() => setVoiding(entry)}
                        onHistory={() => setHistoryOf(entry)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 pt-4 md:px-6">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Showing {rows.length}
                  {exactCount !== null && ` of ${exactCount}`}
                </p>
                {pages.nextCursor && (
                  <Button variant="secondary" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
                    {loadingMore ? "Loading…" : "Show more"}
                  </Button>
                )}
              </div>
              {moreError && (
                <div className="px-5 pt-3 md:px-6">
                  <FormMessage tone="error">We couldn&apos;t load more entries. Check your connection and try again.</FormMessage>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Add (URL: ?add=expense|income|transfer, so the topbar button is a real link) */}
      <AddEntryDialog
        type={addType}
        {...formProps}
        lastExpenseAccountId={context.lastExpenseAccountId}
        onTypeChange={(type) => replaceUrl(href({}, { add: type }))}
        onClose={closeAdd}
      />
      <EditEntryDialog
        entry={editing}
        {...formProps}
        onClose={() => {
          setEditing(null)
          closeDeepLink()
        }}
      />
      <VoidEntryDialog entry={voiding} lookup={lookup} onClose={() => setVoiding(null)} />
      <HistoryDialog
        entry={historyOf}
        lookup={lookup}
        onClose={() => {
          setHistoryOf(null)
          closeDeepLink()
        }}
      />
    </>
  )
}

function Row({
  entry,
  lookup,
  onEdit,
  onVoid,
  onHistory,
}: {
  entry: LedgerItem
  lookup: Lookup
  onEdit: () => void
  onVoid: () => void
  onHistory: () => void
}) {
  const title = entryTitle(entry, lookup)
  // The list only has current versions; a voided one can't change any more.
  const canChange = !entry.voided
  const edited = Boolean(entry.replacesId)
  return (
    <li className={cn("flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0 md:gap-4 md:px-6", entry.voided && "bg-canvas/60")}>
      <EntryIcon entry={entry} lookup={lookup} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
          <span className={cn("truncate", entry.voided && "text-muted-foreground")}>{title}</span>
          {edited && <Badge tone="info">Edited</Badge>}
          {entry.voided && <Badge tone="negative">Voided</Badge>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {entryKindLabel(entry, lookup)}
          <span className="md:hidden"> · {accountChipText(entry, lookup)}</span>
          {entry.voided && entry.voidReason && <> · Reason: {entry.voidReason}</>}
        </p>
      </div>
      <Badge tone="neutral" className="hidden max-w-56 truncate md:inline-flex">
        {accountChipText(entry, lookup)}
      </Badge>
      <p
        className={cn(
          "shrink-0 text-right text-sm font-semibold tabular-nums",
          entry.voided ? "text-muted-foreground line-through" : entry.type === "income" ? "text-success" : "text-ink"
        )}
      >
        {signedAmount(entry)}
        {entry.voided && <span className="sr-only"> (voided, not counted)</span>}
      </p>
      <div className="hidden w-52 shrink-0 items-center justify-end gap-1 lg:flex">
        {canChange && (
          <>
            <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${title}`}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={onVoid} aria-label={`Void ${title}`}>
              Void
            </Button>
          </>
        )}
        {edited && (
          <Button variant="ghost" size="sm" onClick={onHistory} aria-label={`History of ${title}`}>
            History
          </Button>
        )}
      </div>
      {(canChange || edited) && (
        <Menu.Root>
          <Menu.Trigger
            aria-label={`More actions for ${title}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink outline-none hover:bg-canvas focus-visible:outline-2 focus-visible:outline-ring lg:hidden"
          >
            <Ellipsis aria-hidden="true" className="size-5" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner align="end" sideOffset={4} className="z-50">
              <Menu.Popup className="min-w-36 rounded-xl border border-line bg-surface p-1 text-sm text-ink shadow-(--shadow-raised) outline-none">
                {canChange && (
                  <>
                    <MenuItem onClick={onEdit}>Edit</MenuItem>
                    <MenuItem onClick={onVoid}>Void</MenuItem>
                  </>
                )}
                {edited && <MenuItem onClick={onHistory}>History</MenuItem>}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
      {!(canChange || edited) && <span aria-hidden="true" className="size-11 shrink-0 lg:hidden" />}
    </li>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Menu.Item onClick={onClick} className="flex h-10 cursor-default items-center rounded-lg px-3 outline-none data-highlighted:bg-canvas">
      {children}
    </Menu.Item>
  )
}

export function TransactionsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading transactions">
      <PageHeader {...TRANSACTIONS_HEADER} />
      <div className="mb-4 h-13 w-full max-w-md rounded-xl bg-surface" />
      <Card className="mb-6 grid gap-4">
        <span className="h-11 rounded-lg bg-canvas" />
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-16 rounded-lg bg-canvas" />
          ))}
        </div>
      </Card>
      <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="grid gap-4">
            <span className="h-4 w-28 rounded bg-canvas" />
            <span className="h-9 w-40 rounded bg-canvas" />
            <span className="h-4 w-32 rounded bg-canvas" />
          </Card>
        ))}
      </div>
      <Card className="grid gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="size-11 rounded-xl bg-canvas" />
            <span className="grid flex-1 gap-2">
              <span className="h-4 w-40 rounded bg-canvas" />
              <span className="h-3 w-28 rounded bg-canvas" />
            </span>
            <span className="h-4 w-20 rounded bg-canvas" />
          </div>
        ))}
      </Card>
    </div>
  )
}
