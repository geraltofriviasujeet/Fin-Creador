"use client"

import { useActionState, useCallback, useEffect, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Menu } from "@base-ui/react/menu"
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react"
import { type AccountKind, type IncomePeriodKey, isInRange, yearRange } from "@fin-creador/domain"
import { cn } from "cn"
import { setAccountArchivedAction } from "@/app/(app)/income/actions"
import { AccountForm } from "@/components/income/account-form"
import { BarChart, Dot, OTHER, SERIES } from "@/components/income/bar-chart"
import { CashForm } from "@/components/income/cash-form"
import { money, shortDate, shortDateTime } from "@/components/income/format"
import { AnimatedAmount } from "@/components/ui/count-up"
import { IncomeForm } from "@/components/income/income-form"
import { SourceEntries } from "@/components/income/source-entries"
import { SourceForm } from "@/components/income/source-form"
import { useFormSuccess } from "@/components/income/use-form-success"
import { PageHeader } from "@/components/shell/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { FormMessage } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { initialFormState } from "@/lib/form-state"
import type { IncomeAccount, IncomePageData } from "@/lib/income/types"
import type { AccountRowView, IncomePageView, PeriodView, SourceRowView } from "@/lib/income/view"

type Open =
  | { type: "income"; accountId?: string }
  | { type: "account"; kind: AccountKind; account?: IncomeAccount }
  | { type: "cash" }
  | { type: "source" }
  | { type: "entries"; sourceId: string }
  | { type: "archive"; account: IncomeAccount }
  | { type: "archived" }
  | { type: "banks" }
  | null

const ADD_TITLES: Record<AccountKind, string> = { bank: "Add bank account", cash: "Add cash", other: "Add other account" }

const MENU_ITEM = "flex h-10 cursor-default items-center rounded-lg px-3 outline-none data-[highlighted]:bg-canvas"
const INLINE_LINK = "-mx-1 inline-flex min-h-11 items-center px-1 font-semibold text-ink underline underline-offset-4"

// Phones (≤640px): each table row becomes a card (name and amount on one line, details
// below). The table keeps its roles, so screen readers still hear a table.
const TABLE = "w-full border-collapse text-sm max-[640px]:block"
const THEAD = "text-left text-xs text-muted-foreground max-[640px]:hidden"
const TBODY = "max-[640px]:grid max-[640px]:gap-2"
const TR =
  "border-b border-line align-middle max-[640px]:grid max-[640px]:grid-cols-[minmax(0,1fr)_auto_auto] max-[640px]:items-start max-[640px]:gap-x-3 max-[640px]:rounded-xl max-[640px]:border max-[640px]:p-3"
const TH = "px-2 py-2 font-medium first:pl-0 last:pr-0"
const TD = "px-2 py-3 first:pl-0 last:pr-0 max-[640px]:p-0"
const WIDE = "max-[640px]:hidden"
const PHONE = "min-[641px]:hidden"
const TFOOT_TR = "max-[640px]:mt-2 max-[640px]:flex max-[640px]:justify-between max-[640px]:px-3"

const PERIODS: IncomePeriodKey[] = ["month", "year", "all"]
const PERIOD_WORDS: Record<IncomePeriodKey, string> = { month: "this month", year: "this year", all: "recorded" }

const colorClass = (color: SourceRowView["color"]) => (color === null ? null : color === "other" ? OTHER : SERIES[color]!)

/** The Income page (design-spec §9, redesigned 2026-11): Accounts, then Income, each a bar chart above a table. */
/** `view`: every figure, built on the server (lib/income/view.ts). `upcoming`: the compact Upcoming card. */
export function IncomeView({
  data,
  view,
  initialPeriod,
  upcoming,
}: {
  data: IncomePageData
  view: IncomePageView
  initialPeriod: IncomePeriodKey
  upcoming?: React.ReactNode
}) {
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

  // Deep links: /income?add=income (topbar "Add income") and ?add=bank. Handled
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

  // Period switch: month and year are already here; All time is rendered by the server on
  // request (?period=all), so it is loaded only when someone asks for it.
  const [period, setPeriod] = useState<IncomePeriodKey>(initialPeriod)
  const [loadingAll, startLoadingAll] = useTransition()
  const choosePeriod = (next: IncomePeriodKey) => {
    setPeriod(next)
    const url = next === "all" ? `${pathname}?period=all` : next === "year" ? `${pathname}?period=year` : pathname
    if (next === "all" && !view.periods.all) startLoadingAll(() => router.push(url, { scroll: false }))
    else window.history.replaceState(null, "", url)
  }
  const shown: PeriodView | undefined = view.periods[period]

  const activeAccounts = view.accounts.rows.map((r) => r.account)
  const activeSources = sources.filter((s) => !s.archived)
  const year = today.slice(0, 4)
  // One active cash account per person: once it exists, "Add cash" updates it.
  const activeCash = accounts.find((a) => a.kind === "cash" && !a.archived)
  const addOrUpdateCash = () => show(activeCash ? { type: "cash" } : { type: "account", kind: "cash" })
  const a = view.accounts

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
              Record income
            </Button>
          </div>
        }
      />

      <div className="grid gap-4">
        {/* ---------------------------------------------------------------- Accounts */}
        <Card role="region" aria-labelledby="accounts-title" data-section="accounts">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div>
              <CardTitle id="accounts-title">Accounts</CardTitle>
              <CardDescription className="mt-1">Balances as of today</CardDescription>
            </div>
            <div className="grid justify-items-end text-right" data-testid="total-available">
              <span className="text-sm text-muted-foreground">Total available</span>
              <span className="font-heading text-2xl font-semibold tabular-nums md:text-3xl">
                <AnimatedAmount id="total-available" minor={a.totalAvailableMinor} currency={currency} />
              </span>
            </div>
          </div>

          {a.rows.length === 0 ? (
            <div className="mt-4 grid gap-3 rounded-xl bg-canvas p-5">
              <p className="font-semibold">Add your first account</p>
              <p className="text-sm text-muted-foreground">Add the banks and cash where you keep money to see your total.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => show({ type: "account", kind: "bank" })}>Add bank account</Button>
                <Button variant="secondary" onClick={addOrUpdateCash}>
                  Add cash
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-5">
                <BarChart
                  label="Balance by account"
                  zeroBp={a.zeroBp}
                  items={a.rows.map((r) => ({
                    key: r.account.id,
                    label: r.account.label,
                    amount: money(r.balanceMinor, r.account.currency),
                    startBp: r.bar?.startBp ?? null,
                    lengthBp: r.bar?.lengthBp ?? 0,
                    colorClass: r.inTotal ? "bg-brand-deep" : OTHER,
                    note: r.inTotal ? undefined : "Not in total",
                  }))}
                />
              </div>
              <AccountsTable
                rows={a.rows}
                totalMinor={a.totalAvailableMinor}
                currency={currency}
                onEdit={(account) => show(account.kind === "cash" ? { type: "cash" } : { type: "account", kind: account.kind, account })}
                onImport={(account) => router.push(`/income/import?account=${encodeURIComponent(account.id)}`)}
                onArchive={(account) => show({ type: "archive", account })}
              />
              {/* Subtotals (the former Money in banks and Cash in hand cards). */}
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm text-muted-foreground min-[641px]:flex min-[641px]:flex-wrap">
                <div className="flex flex-wrap items-center gap-x-1.5">
                  <dt>Money in banks</dt>
                  <dd className="font-semibold text-ink tabular-nums">{money(a.moneyInBanksMinor, currency)}</dd>
                  {a.bankCount > 0 && (
                    <dd>
                      ·{" "}
                      <button type="button" className={INLINE_LINK} aria-haspopup="dialog" onClick={() => show({ type: "banks" })}>
                        {a.bankCount} account{a.bankCount === 1 ? "" : "s"}
                      </button>
                    </dd>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-1.5">
                  <dt>Cash in hand</dt>
                  <dd className="font-semibold text-ink tabular-nums">{money(a.cashInHandMinor, currency)}</dd>
                  <dd>· {a.cashUpdatedAt ? `as of ${shortDateTime(a.cashUpdatedAt, timeZone)}` : "no cash added yet"}</dd>
                </div>
              </dl>
            </>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={addOrUpdateCash}>
              <Plus aria-hidden="true" />
              {activeCash ? "Update cash" : "Add cash"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => show({ type: "account", kind: "other" })}>
              <Plus aria-hidden="true" />
              Add other account
            </Button>
            {a.archived.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => show({ type: "archived" })}>
                Show archived ({a.archived.length})
              </Button>
            )}
          </div>
        </Card>

        {upcoming}

        {/* ---------------------------------------------------------------- Income */}
        <Card role="region" aria-labelledby="income-title" data-section="income">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="grid gap-3">
              <div>
                <CardTitle id="income-title">Income by source</CardTitle>
                <CardDescription className="mt-1">{shown?.rangeLabel ?? "All recorded income"}</CardDescription>
              </div>
              <div role="group" aria-label="Period" className="inline-flex w-fit rounded-xl bg-canvas p-1">
                {PERIODS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={period === key}
                    onClick={() => choosePeriod(key)}
                    className={cn(
                      "min-h-9 rounded-lg px-3 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring",
                      period === key ? "bg-surface text-ink shadow-sm" : "text-muted-foreground hover:text-ink",
                    )}
                  >
                    {key === "month" ? "This month" : key === "year" ? `This year (${year})` : "All time"}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid justify-items-end text-right" data-testid="period-total">
              <span className="text-sm text-muted-foreground">Income {PERIOD_WORDS[period]}</span>
              <span className="font-heading text-2xl font-semibold tabular-nums md:text-3xl">
                {shown ? money(shown.totalMinor, currency) : "…"}
              </span>
            </div>
          </div>

          {!shown ? (
            <div aria-busy={loadingAll} className="mt-5 grid gap-3" aria-label="Loading all income">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-6 w-full rounded bg-canvas" />
              ))}
            </div>
          ) : (
            <>
              {shown.bars.length === 0 ? (
                <div className="mt-5 grid justify-items-start gap-3 rounded-xl bg-canvas p-5">
                  <p className="font-semibold">{period === "all" ? "No income recorded yet" : `No income ${PERIOD_WORDS[period]} yet`}</p>
                  <p className="text-sm text-muted-foreground">Record income to see it by source here.</p>
                  <Button onClick={() => show({ type: "income" })}>
                    <Plus aria-hidden="true" />
                    Record income
                  </Button>
                </div>
              ) : (
                <div className="mt-5">
                  <BarChart
                    label="Income by source"
                    zeroBp={shown.zeroBp}
                    items={shown.bars.map((b) => ({
                      key: b.key,
                      label: b.label,
                      amount: money(b.amountMinor, currency),
                      startBp: b.startBp,
                      lengthBp: b.lengthBp,
                      colorClass: b.colorIndex === null ? OTHER : SERIES[b.colorIndex]!,
                    }))}
                  />
                </div>
              )}
              {shown.rows.length > 0 && (
                <IncomeTable period={shown} currency={currency} onOpen={(sourceId) => show({ type: "entries", sourceId })} />
              )}
            </>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => show({ type: "source" })}>
              <Plus aria-hidden="true" />
              Add source
            </Button>
          </div>
        </Card>
      </div>

      <Dialog open={open !== null} onOpenChange={(next) => !next && close()}>
        {open?.type === "income" && (
          <DialogContent title="Add income">
            <IncomeForm
              key={openId}
              accounts={activeAccounts}
              sources={activeSources}
              today={today}
              presetAccountId={open.accountId}
              onDone={close}
              onAddAccount={() => show({ type: "account", kind: "bank" })}
            />
          </DialogContent>
        )}
        {open?.type === "account" && (
          <DialogContent
            eyebrow={open.kind === "cash" ? undefined : open.account ? "Edit account" : "New account"}
            title={open.account ? open.account.label : ADD_TITLES[open.kind]}
          >
            <AccountForm
              key={openId}
              kind={open.kind}
              account={open.account}
              currency={currency}
              today={today}
              onDone={close}
            />
          </DialogContent>
        )}
        {open?.type === "cash" && activeCash && (
          <DialogContent title="Update cash in hand">
            <CashForm key={openId} cash={activeCash} onDone={close} onAddIncome={() => show({ type: "income", accountId: activeCash.id })} />
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
              entries={entries.filter((e) => e.sourceId === open.sourceId && isInRange(e.occurredOn, yearRange(today)))}
              onDone={close}
            />
          </DialogContent>
        )}
        {open?.type === "archive" && (
          <DialogContent eyebrow="Archive account" title={`Archive ${open.account.label}?`}>
            <ArchiveForm key={openId} account={open.account} onDone={close} />
          </DialogContent>
        )}
        {open?.type === "banks" && (
          <DialogContent title="Bank accounts" description="Balances as of today.">
            <ul className="grid divide-y divide-line">
              {a.rows.filter((r) => r.account.kind === "bank").map(({ account, balanceMinor, inTotal }) => (
                <li key={account.id}>
                  <button
                    type="button"
                    onClick={() => show({ type: "account", kind: "bank", account })}
                    className="flex min-h-14 w-full items-center gap-3 rounded-lg px-1 py-3 text-left outline-none hover:bg-canvas/60 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{account.label}</span>
                    {!inTotal && <Badge tone="neutral">Not in total</Badge>}
                    <span className="font-semibold tabular-nums">{money(balanceMinor, account.currency)}</span>
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-4">
              <span className="text-sm text-muted-foreground">Money in banks</span>
              <span className="font-heading text-xl font-semibold tabular-nums">{money(a.moneyInBanksMinor, currency)}</span>
            </div>
          </DialogContent>
        )}
        {open?.type === "archived" && (
          <DialogContent eyebrow="Accounts" title="Archived accounts" description="Archived accounts are not in your totals. Their income history stays.">
            <ul className="grid gap-2">
              {a.archived.map((acc) => (
                <li key={acc.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
                  <span className="text-sm">{acc.label}</span>
                  <RestoreForm account={acc} />
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

// Restoring removes this row from the archived list in the same update, so the result
// is announced from the submit handler (the toast lives outside this component), not
// from an effect in a row that has already disappeared.
function RestoreForm({ account }: { account: IncomeAccount }) {
  const [pending, startRestore] = useTransition()
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        startRestore(async () => {
          const result = await setAccountArchivedAction(initialFormState, formData)
          if (result.status === "success") toast.success(result.message ?? "Account restored.")
          else toast.error(result.message ?? "We couldn't restore that account. Please try again.")
        })
      }}
    >
      <input type="hidden" name="id" value={account.id} />
      <input type="hidden" name="archived" value="false" />
      <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-busy={pending}>
        {pending ? "Restoring…" : "Restore"}
      </Button>
    </form>
  )
}

function AccountsTable({
  rows,
  totalMinor,
  currency,
  onEdit,
  onImport,
  onArchive,
}: {
  rows: AccountRowView[]
  totalMinor: number
  currency: string
  onEdit: (account: IncomeAccount) => void
  onImport: (account: IncomeAccount) => void
  onArchive: (account: IncomeAccount) => void
}) {
  return (
    <table role="table" aria-label="Accounts" className={cn(TABLE, "mt-5")}>
      <thead role="rowgroup" className={THEAD}>
        <tr role="row" className="border-b border-line">
          <th role="columnheader" scope="col" className={TH}>Account</th>
          <th role="columnheader" scope="col" className={TH}>Type</th>
          <th role="columnheader" scope="col" className={TH}>Number</th>
          <th role="columnheader" scope="col" className={cn(TH, "text-right")}>Balance</th>
          <th role="columnheader" scope="col" className={TH}>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup" className={TBODY}>
        {rows.map(({ account, balanceMinor, inTotal, typeLabel }) => (
          <tr role="row" key={account.id} data-account={account.label} className={TR}>
            <td role="cell" className={cn(TD, "min-w-0")}>
              <span className="block truncate font-semibold">{account.name}</span>
              {/* Phones: the details under the name. */}
              <span className={cn(PHONE, "mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground")}>
                {typeLabel}
                {account.last4 && <span className="tabular-nums">··{account.last4}</span>}
                {!inTotal && <Badge tone="neutral">Not in total</Badge>}
              </span>
            </td>
            <td role="cell" className={cn(TD, WIDE, "text-muted-foreground")}>
              {typeLabel}
              {!inTotal && (
                <Badge tone="neutral" className="ml-2">
                  Not in total
                </Badge>
              )}
            </td>
            <td role="cell" className={cn(TD, WIDE, "text-muted-foreground tabular-nums")}>{account.last4 ? `··${account.last4}` : ""}</td>
            <td role="cell" className={cn(TD, "text-right font-semibold whitespace-nowrap tabular-nums")} data-balance>
              {money(balanceMinor, account.currency)}
            </td>
            <td role="cell" className={cn(TD, "w-10 text-right max-[640px]:-mt-1.5 max-[640px]:-mr-1.5")}>
              <Menu.Root>
                <Menu.Trigger
                  aria-label={`Actions for ${account.label}`}
                  className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-canvas focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <MoreHorizontal aria-hidden="true" className="size-4" />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner align="end" sideOffset={4} className="z-50">
                    <Menu.Popup className="min-w-36 rounded-xl border border-line bg-surface p-1 text-sm text-ink shadow-(--shadow-raised) outline-none">
                      <Menu.Item className={MENU_ITEM} onClick={() => onEdit(account)}>
                        {account.kind === "cash" ? "Update amount" : "Edit"}
                      </Menu.Item>
                      {account.kind === "bank" && (
                        <Menu.Item className={MENU_ITEM} onClick={() => onImport(account)}>
                          Import statement
                        </Menu.Item>
                      )}
                      <Menu.Item className={MENU_ITEM} onClick={() => onArchive(account)}>
                        Archive
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot role="rowgroup" className="max-[640px]:block">
        <tr role="row" className={TFOOT_TR}>
          <th role="rowheader" scope="row" colSpan={3} className={cn(TD, "pt-3 text-left font-semibold")}>
            Total
          </th>
          <td role="cell" className={cn(TD, "pt-3 text-right font-heading text-base font-semibold tabular-nums")} data-total>
            {money(totalMinor, currency)}
          </td>
          <td role="cell" className={cn(TD, WIDE)} />
        </tr>
      </tfoot>
    </table>
  )
}

function IncomeTable({ period, currency, onOpen }: { period: PeriodView; currency: string; onOpen: (sourceId: string) => void }) {
  return (
    <table role="table" aria-label={`Income by source, ${period.tabLabel.toLowerCase()}`} className={cn(TABLE, "mt-5")}>
      <thead role="rowgroup" className={THEAD}>
        <tr role="row" className="border-b border-line">
          <th role="columnheader" scope="col" className={TH}>Source</th>
          <th role="columnheader" scope="col" className={TH}>Note</th>
          <th role="columnheader" scope="col" className={TH}>Last received</th>
          <th role="columnheader" scope="col" className={TH}>Repeats</th>
          <th role="columnheader" scope="col" className={cn(TH, "text-right")}>Amount</th>
        </tr>
      </thead>
      <tbody role="rowgroup" className={TBODY}>
        {period.rows.map((r) => {
          const repeats = r.repeats.length > 0 ? r.repeats.join(", ") : "One-off"
          const received = r.lastReceivedOn ? shortDate(r.lastReceivedOn) : "—"
          return (
            <tr role="row" key={r.sourceId} data-source={r.name} className={TR}>
              <td role="cell" className={cn(TD, "min-w-0")}>
                {/* Opens the source's entries this year (edit, void, history). */}
                <button
                  type="button"
                  onClick={() => onOpen(r.sourceId)}
                  className="-mx-1 flex min-h-9 max-w-full items-center gap-2 rounded-lg px-1 text-left font-semibold outline-none hover:bg-canvas focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Dot className={colorClass(r.color)} />
                  <span className="truncate">{r.name}</span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </button>
                {r.linkedLabel && <span className="block truncate pl-5.5 text-xs text-muted-foreground">{r.linkedLabel}</span>}
                {r.onlyVoided && <span className="block pl-5.5 text-xs text-muted-foreground">Voided entries only</span>}
                {/* Phones: the details under the name. */}
                <span className={cn(PHONE, "mt-1 flex flex-wrap gap-x-1 pl-5.5 text-xs text-muted-foreground")}>
                  <span className="whitespace-nowrap">Last received {received} ·</span>
                  <span className="whitespace-nowrap">{repeats}</span>
                </span>
                {r.note && (
                  <span className={cn(PHONE, "block pl-5.5")}>
                    <Note text={r.note} />
                  </span>
                )}
              </td>
              <td role="cell" className={cn(TD, WIDE, "max-w-56")}>
                {r.note ? <Note text={r.note} /> : <span className="text-muted-foreground">—</span>}
              </td>
              <td role="cell" className={cn(TD, WIDE, "whitespace-nowrap text-muted-foreground")}>{received}</td>
              <td role="cell" className={cn(TD, WIDE, "text-muted-foreground")}>{repeats}</td>
              <td role="cell" className={cn(TD, "text-right font-semibold whitespace-nowrap tabular-nums")} data-amount>
                {money(r.amountMinor, currency)}
              </td>
            </tr>
          )
        })}
      </tbody>
      <tfoot role="rowgroup" className="max-[640px]:block">
        <tr role="row" className={TFOOT_TR}>
          <th role="rowheader" scope="row" colSpan={4} className={cn(TD, "pt-3 text-left font-semibold")}>
            Total
          </th>
          <td role="cell" className={cn(TD, "pt-3 text-right font-heading text-base font-semibold tabular-nums")} data-total>
            {money(period.totalMinor, currency)}
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

/** A note cut to one line; the full text on hover (title) or tap (expands in place). */
function Note({ text }: { text: string }) {
  const [full, setFull] = useState(false)
  return (
    <button
      type="button"
      title={text}
      aria-expanded={full}
      onClick={() => setFull((f) => !f)}
      className={cn(
        "block max-w-full rounded text-left text-xs text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring min-[641px]:text-sm",
        full ? "whitespace-normal break-words" : "truncate",
      )}
    >
      {text}
    </button>
  )
}
