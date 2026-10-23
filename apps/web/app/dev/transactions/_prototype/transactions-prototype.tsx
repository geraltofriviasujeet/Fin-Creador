"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Menu } from "@base-ui/react/menu"
import { Ellipsis, FlaskConical, Plus, Search, X } from "lucide-react"
import {
  type IsoDate,
  currentVersions,
  formatPercentFromBasisPoints,
  incomeTrendBasisPoints,
  periodTotals,
  postedActivity,
  savingsRateBasisPoints,
  summarizeHoldings,
  versionHistory,
} from "@fin-creador/domain"
import { cn } from "cn"
import { StatCard } from "@/components/income/stat-card"
import { PageHeader } from "@/components/shell/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { type DemoData, type DemoEntry, createDemoData } from "./demo-data"
import {
  EntryIcon,
  TYPE_NOUN,
  accountChipText,
  dayHeading,
  entryKindLabel,
  entryTitle,
  money,
  rangeText,
  signedAmount,
} from "./display"
import { HistoryList, VoidForm } from "./entry-dialogs"
import {
  type Filters,
  type Lookup,
  PERIODS,
  TYPE_TABS,
  filterForList,
  filterForSummary,
  filtersToQuery,
  groupByDay,
  hasActiveFilters,
  periodLabel,
  periodRange,
  previousPeriod,
  readFilters,
} from "./filters"
import { type Draft, type EntryType, type SaveResult, TransactionForm } from "./transaction-form"

const PAGE_SIZE = 10
const HEADER = { eyebrow: "Money activity", title: "Transactions", description: "See every rupee coming in and going out." }
type DemoState = "normal" | "empty" | "loading" | "error"
const DEMO_STATES: { value: DemoState; label: string }[] = [
  { value: "normal", label: "With entries" },
  { value: "empty", label: "No entries" },
  { value: "loading", label: "Loading" },
  { value: "error", label: "Load error" },
]
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Reads the URL; remounts the prototype when the demo state changes (fresh demo data). */
export function TransactionsPrototype({ today }: { today: IsoDate }) {
  const params = useSearchParams()
  const raw = params.get("demo")
  const demo: DemoState = DEMO_STATES.some((s) => s.value === raw) ? (raw as DemoState) : "normal"
  return <Prototype key={demo} demo={demo} today={today} />
}

function Prototype({ demo, today }: { demo: DemoState; today: IsoDate }) {
  const params = useSearchParams()
  const pathname = usePathname()
  const [data, setData] = useState<DemoData>(() => createDemoData(today, { empty: demo === "empty" }))
  const [failNext, setFailNext] = useState(false)
  const [savedKeys] = useState(() => new Set<string>())
  const [shown, setShown] = useState(PAGE_SIZE)
  const [editing, setEditing] = useState<DemoEntry | null>(null)
  const [voiding, setVoiding] = useState<DemoEntry | null>(null)
  const [historyOf, setHistoryOf] = useState<DemoEntry | null>(null)

  const f = readFilters(params, today)
  const extra = { demo: demo === "normal" ? "" : demo }
  const href = (next: Partial<Filters>, more: Record<string, string> = {}) => `${pathname}${filtersToQuery({ ...f, ...next }, { ...extra, ...more })}`
  // Filters change the URL in place (Next keeps useSearchParams in sync) with no server
  // round trip, so controls respond at once and links and the back button still work.
  const replaceUrl = (url: string) => window.history.replaceState(null, "", url)
  const go = (next: Partial<Filters>) => {
    setShown(PAGE_SIZE)
    replaceUrl(href(next))
  }
  const addParam = params.get("add")
  const addType: EntryType | null = addParam === "expense" || addParam === "income" || addParam === "transfer" ? addParam : null
  const closeAdd = () => replaceUrl(href({}))

  const lookup: Lookup = useMemo(
    () => ({ accounts: new Map(data.accounts.map((a) => [a.id, a])), categories: new Map(data.categories.map((c) => [c.id, c])) }),
    [data.accounts, data.categories]
  )
  const range = periodRange(f, today)
  const summarySet = filterForSummary(data.entries, f, range, lookup)
  const totals = periodTotals(summarySet, range, data.currency)
  const prevRange = previousPeriod(f, today)
  const prevTotals = prevRange ? periodTotals(filterForSummary(data.entries, f, prevRange, lookup), prevRange, data.currency) : null
  const rows = filterForList(summarySet, f)
  const groups = groupByDay(rows.slice(0, shown))
  const replaced = new Set(data.entries.map((e) => e.replacesId).filter(Boolean))
  const isEdited = (e: DemoEntry) => Boolean(e.replacesId)

  function totalAvailable(entries: DemoEntry[]) {
    const activity = postedActivity(data.accounts, entries)
    return summarizeHoldings(
      data.accounts.map((a) => ({ ...a, ...activity.get(a.id)! })),
      data.currency
    ).totalAvailableMinor
  }

  // Simulated server call: latency, an optional failure, and the idempotency key check.
  async function simulate(requestKey: string | null, apply: (d: DemoData) => DemoData): Promise<SaveResult> {
    await wait(700)
    if (failNext) {
      setFailNext(false)
      return { ok: false, message: "We couldn't save this (simulated network error). Your details are kept; try again." }
    }
    if (requestKey && savedKeys.has(requestKey)) return { ok: true } // replay: saved once only
    if (requestKey) savedKeys.add(requestKey)
    setData(apply)
    return { ok: true }
  }

  const newEntry = (draft: Draft, replacesId: string | null): DemoEntry => ({
    ...draft,
    id: `t-new-${crypto.randomUUID()}`,
    currency: data.accounts.find((a) => a.id === draft.accountId)?.currency ?? data.currency,
    voided: false,
    replacesId,
    createdAt: new Date().toISOString(),
    voidReason: null,
  })

  async function saveNew(draft: Draft, requestKey: string) {
    const entry = newEntry(draft, null)
    const result = await simulate(requestKey, (d) => ({ ...d, entries: [...d.entries, entry] }))
    if (result.ok) {
      closeAdd()
      toast.success(`${capitalise(TYPE_NOUN[draft.type])} saved.`, `Total available: ${money(totalAvailable([...data.entries, entry]), data.currency)}`)
    }
    return result
  }

  async function saveEdit(original: DemoEntry, draft: Draft, requestKey: string) {
    if (data.entries.some((e) => e.replacesId === original.id) || data.entries.find((e) => e.id === original.id)?.voided) {
      return { ok: false as const, message: "This entry was changed somewhere else. Close and reopen it to see the latest version." }
    }
    const next = newEntry(draft, original.id)
    const result = await simulate(requestKey, (d) => ({
      ...d,
      entries: [...d.entries.map((e) => (e.id === original.id ? { ...e, voided: true } : e)), next],
    }))
    if (result.ok) {
      setEditing(null)
      toast.success("Changes saved.", "The earlier version is kept in History.")
    }
    return result
  }

  async function voidEntry(entry: DemoEntry, reason: string | null) {
    const result = await simulate(null, (d) => ({
      ...d,
      entries: d.entries.map((e) => (e.id === entry.id ? { ...e, voided: true, voidReason: reason } : e)),
    }))
    if (result.ok) {
      setVoiding(null)
      toast.success(`${capitalise(TYPE_NOUN[entry.type])} voided.`, "It stays in your history and no longer counts.")
    }
    return result
  }

  const demoBar = (
    <DemoBar
      demo={demo}
      pathname={pathname}
      failNext={failNext}
      onFailNext={setFailNext}
      onReset={() => {
        setData(createDemoData(today, { empty: demo === "empty" }))
        savedKeys.clear()
        toast.info("Demo data reset.")
      }}
    />
  )
  const addLink = (type: EntryType, label: string, variant: "primary" | "secondary" = "primary") => (
    <Link href={href({}, { add: type })} scroll={false} className={cn(buttonVariants({ variant, size: "lg" }))}>
      <Plus aria-hidden="true" />
      {label}
    </Link>
  )

  if (demo === "loading") return (
    <>
      {demoBar}
      <TransactionsSkeleton />
    </>
  )
  if (demo === "error") {
    return (
      <>
        {demoBar}
        <PageHeader {...HEADER} />
        <FormMessage tone="error">
          We couldn&apos;t load your transactions. Check your connection.{" "}
          <Link href={pathname} className="font-semibold underline underline-offset-4">
            Try again
          </Link>
        </FormMessage>
      </>
    )
  }

  const noEntriesAtAll = data.entries.length === 0
  const incomeTrend = prevTotals ? incomeTrendBasisPoints(totals.incomeMinor, prevTotals.incomeMinor) : null
  const savingsRate = savingsRateBasisPoints(totals)
  const label = periodLabel(f)
  const tabLabel = TYPE_TABS.find((t) => t.value === f.type)?.label ?? "All"

  return (
    <>
      {demoBar}
      <PageHeader {...HEADER} actions={addLink("expense", "Add transaction")} />

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
                  onClick={() => setShown(PAGE_SIZE)}
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
            go({ q: typeof q === "string" ? q.trim() : "" })
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
                {data.categories
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
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
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
            <Link href={`${pathname}${filtersToQuery(readFilters(new URLSearchParams(), today), extra)}`} replace scroll={false} className="text-sm font-semibold underline underline-offset-4">
              Clear filters
            </Link>
          )}
        </div>
      </Card>

      <section aria-label="Totals for these filters" className="mb-2 grid gap-4 md:grid-cols-2 lg:grid-cols-3 md:[&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
        <StatCard
          label={`Income · ${label}`}
          value={money(totals.incomeMinor, data.currency)}
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
          value={money(totals.expenseMinor, data.currency)}
          footer={`${totals.expenseCount} ${totals.expenseCount === 1 ? "expense" : "expenses"}`}
        />
        <StatCard
          label="Net savings"
          value={money(totals.netMinor, data.currency)}
          footer={
            savingsRate === null ? (
              "No income in this period"
            ) : totals.netMinor < 0 ? (
              <span className="text-danger">Spent {money(-totals.netMinor, data.currency)} more than came in</span>
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
            <CardTitle>{f.type === "all" ? "All transactions" : tabLabel}</CardTitle>
            <CardDescription className="mt-1">
              {label} · {rows.length} {rows.length === 1 ? "entry" : "entries"}
              {f.q && ` matching “${f.q}”`}
            </CardDescription>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="grid justify-items-center gap-3 px-5 py-12 text-center md:px-6">
            {noEntriesAtAll ? (
              <>
                <p className="font-heading text-xl font-semibold">No transactions yet</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Add what you spend and receive. Transfers between your own accounts go here too, without counting as income or expenses.
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-3">
                  {addLink("expense", "Add expense")}
                  {addLink("income", "Add income", "secondary")}
                </div>
              </>
            ) : (
              <>
                <p className="font-heading text-xl font-semibold">Nothing matches these filters</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {f.q ? "Search looks in notes, category and account names, and exact amounts. " : ""}Try another period or clear the filters.
                </p>
                <Link href={`${pathname}${filtersToQuery(readFilters(new URLSearchParams(), today), extra)}`} replace scroll={false} className={cn(buttonVariants({ variant: "secondary" }))}>
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
                      edited={isEdited(entry)}
                      superseded={replaced.has(entry.id)}
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
                Showing {Math.min(shown, rows.length)} of {rows.length}
              </p>
              {shown < rows.length && (
                <Button variant="secondary" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, rows.length - shown)} more
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Add (URL: ?add=expense|income|transfer, so the topbar button is a real link) */}
      <Dialog open={addType !== null} onOpenChange={(open) => !open && closeAdd()}>
        {addType && (
          <DialogContent eyebrow="New transaction" title={`Add ${TYPE_NOUN[addType]}`}>
            <TransactionForm
              mode={{ kind: "add", type: addType }}
              accounts={data.accounts}
              categories={data.categories}
              entries={currentVersions(data.entries)}
              today={today}
              onTypeChange={(type) => replaceUrl(href({}, { add: type }))}
              onSave={saveNew}
            />
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing && (
          <DialogContent eyebrow="Edit transaction" title={`Edit ${TYPE_NOUN[editing.type]}`} description="Saving keeps the current version in History.">
            <TransactionForm
              mode={{ kind: "edit", entry: editing }}
              accounts={data.accounts}
              categories={data.categories}
              entries={currentVersions(data.entries)}
              today={today}
              onSave={(draft, key) => saveEdit(editing, draft, key)}
            />
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={voiding !== null} onOpenChange={(open) => !open && setVoiding(null)}>
        {voiding && (
          <DialogContent eyebrow="Void transaction" title={`Void this ${TYPE_NOUN[voiding.type]}?`}>
            <VoidForm entry={voiding} lookup={lookup} onVoid={(reason) => voidEntry(voiding, reason)} />
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={historyOf !== null} onOpenChange={(open) => !open && setHistoryOf(null)}>
        {historyOf && (
          <DialogContent eyebrow="History" title={entryTitle(historyOf, lookup)} description="Every saved version, newest first. Earlier versions never count toward totals.">
            <HistoryList versions={versionHistory(data.entries, historyOf.id)} lookup={lookup} />
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

function Row({
  entry,
  lookup,
  edited,
  superseded,
  onEdit,
  onVoid,
  onHistory,
}: {
  entry: DemoEntry
  lookup: Lookup
  edited: boolean
  superseded: boolean
  onEdit: () => void
  onVoid: () => void
  onHistory: () => void
}) {
  const title = entryTitle(entry, lookup)
  const canChange = !entry.voided && !superseded
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
    <Menu.Item
      onClick={onClick}
      className="flex h-10 cursor-default items-center rounded-lg px-3 outline-none data-highlighted:bg-canvas"
    >
      {children}
    </Menu.Item>
  )
}

function DemoBar({
  demo,
  pathname,
  failNext,
  onFailNext,
  onReset,
}: {
  demo: DemoState
  pathname: string
  failNext: boolean
  onFailNext: (v: boolean) => void
  onReset: () => void
}) {
  return (
    <div role="note" className="mb-6 grid gap-3 rounded-xl border border-dashed border-line-strong bg-chip-blue px-4 py-3 text-sm">
      <p className="flex items-start gap-3">
        <FlaskConical aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <span>
          <strong className="font-semibold">Demo data.</strong> Development-only prototype of the Sprint 3 Transactions page. Every
          account and entry here is made up and kept in memory; nothing is saved, and reloading starts again.
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-8">
        <nav aria-label="Prototype states" className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs font-semibold text-muted-foreground">State:</span>
          {DEMO_STATES.map((s) => (
            <Link
              key={s.value}
              href={s.value === "normal" ? pathname : `${pathname}?demo=${s.value}`}
              aria-current={s.value === demo ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-semibold",
                s.value === demo ? "bg-ink text-white" : "text-ink underline underline-offset-4"
              )}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input type="checkbox" checked={failNext} onChange={(e) => onFailNext(e.target.checked)} className="size-4" />
          Make the next save fail
        </label>
        <button type="button" onClick={onReset} className="text-xs font-semibold underline underline-offset-4">
          Reset demo data
        </button>
      </div>
    </div>
  )
}

export function TransactionsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading transactions">
      <PageHeader {...HEADER} />
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

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
