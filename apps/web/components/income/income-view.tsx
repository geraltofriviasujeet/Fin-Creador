"use client"

import { useActionState, useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Menu } from "@base-ui/react/menu"
import { ArrowDownRight, ArrowUpRight, BriefcaseBusiness, ChevronRight, House, MoreHorizontal, Plus } from "lucide-react"
import {
  type AccountKind,
  formatPercentFromBasisPoints,
  incomeBySource,
  incomeTrendBasisPoints,
  isInRange,
  monthRange,
  previousMonthRange,
  rentalIncome,
  sumIncome,
  summarizeHoldings,
  yearRange,
} from "@fin-creador/domain"
import { setAccountArchivedAction } from "@/app/(app)/income/actions"
import { AccountForm } from "@/components/income/account-form"
import { money, shortDateTime } from "@/components/income/format"
import { IncomeForm } from "@/components/income/income-form"
import { SourceEntries } from "@/components/income/source-entries"
import { SourceForm } from "@/components/income/source-form"
import { StatCard } from "@/components/income/stat-card"
import { useFormSuccess } from "@/components/income/use-form-success"
import { PageHeader } from "@/components/shell/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { FormMessage } from "@/components/ui/field"
import { initialFormState } from "@/lib/form-state"
import type { IncomeAccount, IncomePageData } from "@/lib/income/types"

type Open =
  | { type: "income" }
  | { type: "account"; kind: AccountKind; account?: IncomeAccount }
  | { type: "source" }
  | { type: "entries"; sourceId: string }
  | { type: "archive"; account: IncomeAccount }
  | { type: "archived" }
  | null

const ADD_TITLES: Record<AccountKind, string> = { bank: "Add bank account", cash: "Add cash", other: "Add other account" }

/** The Income page (design-spec §9). All figures come from packages/domain. */
export function IncomeView({ data }: { data: IncomePageData }) {
  const { currency, today, timeZone, accounts, sources, entries } = data
  const [open, setOpen] = useState<Open>(null)
  // A fresh id per opened dialog remounts its form, so each Add income gets a new
  // idempotency key (a double submit within one dialog is recorded once).
  const [openId, setOpenId] = useState(0)
  const show = useCallback((next: Open) => {
    setOpenId((n) => n + 1)
    setOpen(next)
  }, [])
  const close = useCallback(() => setOpen(null), [])

  // Deep links: /income?add=income (topbar "Add transaction") and ?add=bank. Handled
  // while rendering so it also works when the link is used on this page.
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const add = params.get("add")
  const [handledAdd, setHandledAdd] = useState<string | null>(null)
  if (add !== handledAdd) {
    setHandledAdd(add)
    if (add === "income" || add === "bank") {
      setOpenId((n) => n + 1)
      setOpen(add === "income" ? { type: "income" } : { type: "account", kind: "bank" })
    }
  }
  useEffect(() => {
    if (add) router.replace(pathname, { scroll: false })
  }, [add, pathname, router])

  const view = useMemo(() => {
    const periods = { month: monthRange(today), previousMonth: previousMonthRange(today), year: yearRange(today) }
    const thisMonth = sumIncome(entries, periods.month, currency)
    const lastMonth = sumIncome(entries, periods.previousMonth, currency)
    const holdings = summarizeHoldings(accounts, currency)
    const cashRows = holdings.rows.filter((r) => r.account.kind === "cash")
    const cashUpdated = cashRows.map((r) => r.account.lastActivityAt).sort().at(-1)
    return {
      periods,
      thisMonth,
      thisYear: sumIncome(entries, periods.year, currency),
      trend: incomeTrendBasisPoints(thisMonth, lastMonth),
      holdings,
      cashUpdated,
      sourceRows: incomeBySource(entries, sources, periods, currency),
      rental: rentalIncome(entries, sources, periods, currency),
    }
  }, [accounts, currency, entries, sources, today])

  const activeAccounts = view.holdings.rows.map((r) => r.account)
  const activeSources = sources.filter((s) => !s.archived)
  const accountLabel = (id: string) => accounts.find((a) => a.id === id)?.label ?? "Account"
  const year = today.slice(0, 4)
  const hasCash = accounts.some((a) => a.kind === "cash")

  return (
    <>
      <PageHeader
        eyebrow="Money in"
        title="Income"
        description="See where your money comes from and where it is held."
        actions={
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="lg" onClick={() => show({ type: "account", kind: "bank" })}>
              <Plus aria-hidden="true" />
              Add bank account
            </Button>
            <Button size="lg" onClick={() => show({ type: "income" })}>
              <Plus aria-hidden="true" />
              Add income
            </Button>
          </div>
        }
      />

      <section aria-label="Summary" className="-mx-4 mb-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3">
        <StatCard
          label="Income this month"
          value={money(view.thisMonth, currency)}
          footer={
            view.trend !== null && (
              <span className={view.trend >= 0 ? "inline-flex items-center gap-1 text-success" : "inline-flex items-center gap-1 text-danger"}>
                {view.trend >= 0 ? <ArrowUpRight aria-hidden="true" className="size-4" /> : <ArrowDownRight aria-hidden="true" className="size-4" />}
                {formatPercentFromBasisPoints(view.trend, { signed: true })} from last month
              </span>
            )
          }
        />
        <StatCard label="Income this year" value={money(view.thisYear, currency)} footer={`January – December ${year}`} />
        <StatCard
          label="Bank accounts"
          value={view.holdings.bankCount}
          footer={
            view.holdings.bankCount === 0
              ? "None added yet"
              : `${view.holdings.savingsCount} savings · ${view.holdings.currentCount} current`
          }
        />
        <StatCard
          label="Money in banks"
          value={money(view.holdings.moneyInBanksMinor, currency)}
          footer={
            view.holdings.bankCount === 0
              ? "Add a bank account to see this"
              : `Across ${view.holdings.bankCount} bank account${view.holdings.bankCount === 1 ? "" : "s"}`
          }
        />
        <StatCard
          label="Cash in hand"
          value={money(view.holdings.cashInHandMinor, currency)}
          footer={view.cashUpdated ? `As of ${shortDateTime(view.cashUpdated, timeZone)}` : "No cash added yet"}
        />
        <StatCard
          label="Rental income"
          value={money(view.rental.monthMinor, currency)}
          footer={
            view.rental.hasRentSource ? (
              `${money(view.rental.yearMinor, currency)} this year`
            ) : (
              <button type="button" className="font-semibold text-ink underline underline-offset-4" onClick={() => show({ type: "source" })}>
                Add a rental source
              </button>
            )
          }
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.45fr_0.8fr]">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Income sources</CardTitle>
              <CardDescription className="mt-1">Monthly and yearly earnings by source</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="text-success" onClick={() => show({ type: "source" })}>
              Add source
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>

          {view.sourceRows.length === 0 ? (
            <div className="mt-6 grid justify-items-start gap-3 rounded-xl bg-canvas p-5">
              <p className="font-semibold">No income recorded yet</p>
              <p className="text-sm text-muted-foreground">Your sources appear here with this month&apos;s and this year&apos;s income.</p>
              <Button onClick={() => show({ type: "income" })}>
                <Plus aria-hidden="true" />
                Add income
              </Button>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {view.sourceRows.map(({ source, monthMinor, yearMinor, linked, onlyVoided }) => (
                <li key={source.id}>
                  <button
                    type="button"
                    onClick={() => show({ type: "entries", sourceId: source.id })}
                    className="flex w-full items-center gap-4 rounded-xl py-4 text-left outline-none hover:bg-canvas/60 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-chip-mint text-ink">
                      {source.sourceType === "rent" ? <House aria-hidden="true" className="size-5" /> : <BriefcaseBusiness aria-hidden="true" className="size-5" />}
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate font-semibold">{source.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {linked.kind === "multiple" ? "Multiple accounts" : linked.kind === "account" ? accountLabel(linked.accountId) : "No account yet"}
                      </span>
                      {onlyVoided && <span className="text-xs text-muted-foreground">Voided entries only</span>}
                    </span>
                    <span className="grid justify-items-end gap-0.5 tabular-nums">
                      <span className="font-semibold text-success">{money(monthMinor, currency)}</span>
                      <span className="text-xs text-muted-foreground">{money(yearMinor, currency)} yearly</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Where your money is</CardTitle>
          <CardDescription className="mt-1">Available balances</CardDescription>

          {view.holdings.rows.length === 0 ? (
            <div className="mt-6 grid gap-3 rounded-xl bg-canvas p-5">
              <p className="font-semibold">Add your first account</p>
              <p className="text-sm text-muted-foreground">Add the banks and cash where you keep money to see your total.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => show({ type: "account", kind: "bank" })}>Add bank account</Button>
                <Button variant="secondary" onClick={() => show({ type: "account", kind: "cash" })}>
                  Add cash
                </Button>
              </div>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {view.holdings.rows.map(({ account, balanceMinor, inTotal }) => (
                <li key={account.id} className="flex items-center gap-3 py-3.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{account.label}</span>
                  {!inTotal && <Badge tone="neutral">Not in total</Badge>}
                  <span className="font-semibold tabular-nums">{money(balanceMinor, account.currency)}</span>
                  <Menu.Root>
                    <Menu.Trigger
                      aria-label={`Actions for ${account.label}`}
                      className="flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-canvas focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <MoreHorizontal aria-hidden="true" className="size-4" />
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Positioner align="end" sideOffset={4} className="z-50">
                        <Menu.Popup className="min-w-36 rounded-xl border border-line bg-surface p-1 text-sm text-ink shadow-(--shadow-raised) outline-none">
                          <Menu.Item
                            className="flex h-10 cursor-default items-center rounded-lg px-3 outline-none data-[highlighted]:bg-canvas"
                            onClick={() => show({ type: "account", kind: account.kind, account })}
                          >
                            Edit
                          </Menu.Item>
                          <Menu.Item
                            className="flex h-10 cursor-default items-center rounded-lg px-3 outline-none data-[highlighted]:bg-canvas"
                            onClick={() => show({ type: "archive", account })}
                          >
                            Archive
                          </Menu.Item>
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.Root>
                </li>
              ))}
            </ul>
          )}

          <div className="on-dark mt-4 flex items-center justify-between gap-3 rounded-2xl bg-brand-deep px-5 py-4 text-nav-text">
            <span className="text-sm text-nav-muted">Total available</span>
            <span className="font-heading text-2xl font-semibold tabular-nums md:text-3xl">{money(view.holdings.totalAvailableMinor, currency)}</span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => show({ type: "account", kind: "cash" })}>
              <Plus aria-hidden="true" />
              Add cash
            </Button>
            <Button variant="secondary" size="sm" onClick={() => show({ type: "account", kind: "other" })}>
              <Plus aria-hidden="true" />
              Add other account
            </Button>
            {view.holdings.archived.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => show({ type: "archived" })}>
                Show archived ({view.holdings.archived.length})
              </Button>
            )}
          </div>
        </Card>
      </div>

      <Dialog open={open !== null} onOpenChange={(next) => !next && close()}>
        {open?.type === "income" && (
          <DialogContent eyebrow="New transaction" title="Add income">
            <IncomeForm
              key={openId}
              accounts={activeAccounts}
              sources={activeSources}
              today={today}
              onDone={close}
              onAddAccount={() => show({ type: "account", kind: "bank" })}
            />
          </DialogContent>
        )}
        {open?.type === "account" && (
          <DialogContent eyebrow={open.account ? "Edit account" : "New account"} title={open.account ? open.account.label : ADD_TITLES[open.kind]}>
            <AccountForm
              key={openId}
              kind={open.kind}
              account={open.account}
              currency={currency}
              today={today}
              suggestedName={open.kind === "cash" && !hasCash ? "Cash in hand" : undefined}
              onDone={close}
            />
          </DialogContent>
        )}
        {open?.type === "source" && (
          <DialogContent eyebrow="New source" title="Add source">
            <SourceForm key={openId} accounts={activeAccounts} onDone={close} />
          </DialogContent>
        )}
        {open?.type === "entries" && (
          <DialogContent eyebrow={`Income in ${year}`} title={sources.find((s) => s.id === open.sourceId)?.name ?? "Source"}>
            <SourceEntries
              key={openId}
              accounts={accounts}
              entries={entries.filter((e) => e.sourceId === open.sourceId && isInRange(e.occurredOn, view.periods.year))}
              onDone={close}
            />
          </DialogContent>
        )}
        {open?.type === "archive" && (
          <DialogContent eyebrow="Archive account" title={`Archive ${open.account.label}?`}>
            <ArchiveForm key={openId} account={open.account} onDone={close} />
          </DialogContent>
        )}
        {open?.type === "archived" && (
          <DialogContent eyebrow="Accounts" title="Archived accounts" description="Archived accounts are not in your totals. Their income history stays.">
            <ul className="grid gap-2">
              {view.holdings.archived.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
                  <span className="text-sm">{a.label}</span>
                  <RestoreForm account={a} />
                </li>
              ))}
            </ul>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

function ArchiveForm({ account, onDone }: { account: IncomeAccount; onDone: () => void }) {
  const [state, action, pending] = useActionState(setAccountArchivedAction, initialFormState)
  useFormSuccess(state, onDone)
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="id" value={account.id} />
      <input type="hidden" name="archived" value="true" />
      <p className="text-sm">
        {account.label} will leave your totals and the account lists. Its income history stays, and you can restore it later.
      </p>
      {state.status === "error" && state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <div className="flex justify-end gap-3">
        <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Cancel</DialogClose>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Archiving…" : "Archive"}
        </Button>
      </div>
    </form>
  )
}

const noop = () => {}

function RestoreForm({ account }: { account: IncomeAccount }) {
  const [state, action, pending] = useActionState(setAccountArchivedAction, initialFormState)
  useFormSuccess(state, noop)
  return (
    <form action={action}>
      <input type="hidden" name="id" value={account.id} />
      <input type="hidden" name="archived" value="false" />
      <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-busy={pending}>
        {pending ? "Restoring…" : "Restore"}
      </Button>
      {state.status === "error" && <span className="sr-only">{state.message}</span>}
    </form>
  )
}
