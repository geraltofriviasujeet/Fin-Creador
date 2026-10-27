"use client"

import type * as React from "react"
import { useState, useTransition } from "react"
import Link from "next/link"
import { ChevronDown, Plus } from "lucide-react"
import {
  type DepositItem,
  type HoldingGroup,
  type HoldingItem,
  type InstrumentKind,
  type InvestmentsView,
  type WriteResult,
  CATEGORY_OF_KIND,
} from "@fin-creador/api"
import { type PortfolioTotals, formatPercentFromBasisPoints, formatPriceScaled, formatUnits } from "@fin-creador/domain"
import { FD_COMPOUNDING_OPTIONS } from "@fin-creador/schemas"
import { cn } from "cn"
import { deleteFixedDepositAction, deleteHoldingAction, setFixedDepositArchivedAction, setHoldingArchivedAction } from "@/app/(app)/investments/actions"
import { PageHeader } from "@/components/shell/app-shell"
import { fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { FormMessage } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import {
  CATEGORY_LABEL,
  GroupBadges,
  INVESTMENTS_HEADER,
  INVESTMENT_TABS,
  type InvestmentTab,
  KindChip,
  NOT_IN_TOTAL,
  PRICES_NOTE,
  ProfitText,
  priceLabel,
  pricesAsOfText,
} from "./display"
import { DepositForm } from "./deposit-form"
import { HoldingForm } from "./holding-form"

type Open =
  | { kind: "add" }
  | { kind: "addDeposit" }
  | { kind: "edit" | "archive" | "delete"; item: HoldingItem }
  | { kind: "editDeposit" | "archiveDeposit" | "deleteDeposit"; deposit: DepositItem }
  | null

const COMPOUNDING_LABEL = Object.fromEntries(FD_COMPOUNDING_OPTIONS.map((o) => [o.value, o.label])) as Record<string, string>
const FD_NOTE = "Fixed deposits are valued as of today, before tax and TDS."

/** "Emergency fund, ₹1,00,000 from 15 Jan 2026": names a deposit in button labels and dialog text. */
const depositName = (d: DepositItem) => `${d.label ?? d.bank}, ${money(d.principalMinor, "INR")} from ${fullDate(d.startDate)}`

/** Desktop columns: bank, principal, rate, start, maturity, maturity value, accrued today, days left, actions. */
const DEPOSIT_COLUMNS =
  "md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,1.05fr)_minmax(0,1.05fr)_minmax(0,0.85fr)_auto]"

const NETWORK = "We couldn't reach the server. Try again."
async function run(save: () => Promise<WriteResult>): Promise<WriteResult> {
  try {
    return await save()
  } catch {
    return { status: "error", message: NETWORK }
  }
}

/** "10 units bought 15 Jan 2026": names a record in button labels and dialog titles. */
const recordName = (item: HoldingItem) => `${item.instrument.name}, ${formatUnits(item.unitsScaled)} units bought ${fullDate(item.buyDate)}`

/** Desktop columns: name, units, average buy, last price, value, profit or loss. */
const COLUMNS = "md:grid-cols-[minmax(0,2.4fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.35fr)]"

/** Column labels: funds speak of NAV, shares and ETFs of prices. */
type Labels = { average: string; last: string }
const PRICE_LABELS: Labels = { average: "Avg. buy price", last: "Last price" }
const NAV_LABELS: Labels = { average: "Avg. NAV", last: "Latest NAV" }

/** The Shares, Mutual funds and ETFs tabs each add and search their own kind. */
const TAB_KIND: Partial<Record<InvestmentTab, { kind: InstrumentKind; add: string; empty: string; hint: string }>> = {
  shares: { kind: "share", add: "Add share", empty: "No shares yet", hint: "Search a share by name, ticker, BSE scrip code or ISIN, then enter your units and buy price." },
  funds: { kind: "fund", add: "Add mutual fund", empty: "No mutual funds yet", hint: "Search a fund by scheme name, AMFI scheme code or ISIN, then enter your units and buy price." },
  etfs: { kind: "etf", add: "Add ETF", empty: "No ETFs yet", hint: "Search an ETF by name, ticker, BSE scrip code or ISIN, then enter your units and buy price." },
}
const DIALOG_DESCRIPTION: Record<InstrumentKind | "any", string> = {
  any: "Search the fund or share, then enter what you bought.",
  share: "Search the share, then enter what you bought.",
  fund: "Search the mutual fund, then enter what you bought.",
  etf: "Search the ETF, then enter what you bought.",
}

const newest = (dates: string[]) => (dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null)

/** The Investments page (Sprint 7): a holdings tracker, not linked to accounts. */
export function InvestmentsPageView({ view, tab }: { view: InvestmentsView; tab: InvestmentTab }) {
  const [open, setOpen] = useState<Open>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [busy, startBusy] = useTransition()
  const close = () => setOpen(null)
  const add = () => setOpen({ kind: "add" })
  const addDeposit = () => setOpen({ kind: "addDeposit" })
  const hasAny = view.groups.length > 0 || view.deposits.length > 0
  const archivedCount = view.archived.length + view.archivedDeposits.length
  const groups = tab === "all" ? view.groups : view.groups.filter((g) => CATEGORY_OF_KIND[g.instrument.kind] === tab)
  const totals = tab === "all" ? view.totals : view.categories.find((c) => c.category === tab)!.totals
  const labels = tab === "funds" ? NAV_LABELS : PRICE_LABELS

  const restoreWith = (action: () => Promise<WriteResult>) =>
    startBusy(async () => {
      const result = await run(action)
      if (result.status === "success") toast.success(result.message)
      else toast.error(result.message)
    })
  const restore = (item: HoldingItem) => restoreWith(() => setHoldingArchivedAction({ holdingId: item.id, archived: false }))
  const restoreDeposit = (d: DepositItem) => restoreWith(() => setFixedDepositArchivedAction({ depositId: d.id, archived: false }))

  const tabKind = TAB_KIND[tab]
  // All: holdings of any kind and deposits; each other tab adds only its own kind.
  const addHoldingButton = (
    <Button size="lg" onClick={add}>
      <Plus aria-hidden="true" />
      {tabKind?.add ?? "Add holding"}
    </Button>
  )
  const addDepositButton = (
    <Button size="lg" variant={tab === "fds" ? "primary" : "secondary"} onClick={addDeposit}>
      <Plus aria-hidden="true" />
      Add fixed deposit
    </Button>
  )

  return (
    <>
      <PageHeader
        {...INVESTMENTS_HEADER}
        actions={
          <div className="flex flex-wrap gap-2">
            {tab === "all" ? (
              <>
                {addHoldingButton}
                {addDepositButton}
              </>
            ) : tab === "fds" ? (
              addDepositButton
            ) : (
              addHoldingButton
            )}
          </div>
        }
      />

      <TabBar current={tab} />

      {tab === "fds" ? (
        view.deposits.length === 0 ? (
          <Card className="grid justify-items-start gap-3">
            <p className="font-semibold">No fixed deposits yet</p>
            <p className="text-sm text-muted-foreground">Enter the bank, principal, rate and dates to see the maturity value and what it is worth today.</p>
            <Button variant="secondary" onClick={addDeposit}>
              <Plus aria-hidden="true" />
              Add fixed deposit
            </Button>
          </Card>
        ) : (
          <>
            <Summary
              totals={view.categories.find((c) => c.category === "fds")!.totals}
              valueLabel="Worth today"
              profitLabel="Interest so far"
              note={
                <>
                  <span className="font-semibold text-ink">Values as of {fullDate(view.today)}</span> · Interest is added to the deposit (cumulative). Estimates before
                  tax and TDS; your bank&apos;s figures can differ slightly. {NOT_IN_TOTAL}.
                </>
              }
            />
            <DepositList deposits={view.deposits} onOpen={(kind, deposit) => setOpen({ kind, deposit })} />
          </>
        )
      ) : tabKind && groups.length === 0 ? (
        <Card className="grid justify-items-start gap-3">
          <p className="font-semibold">{tabKind.empty}</p>
          <p className="text-sm text-muted-foreground">{tabKind.hint}</p>
          <Button variant="secondary" onClick={add}>
            <Plus aria-hidden="true" />
            {tabKind.add}
          </Button>
          <p className="text-xs text-muted-foreground">
            {PRICES_NOTE} {NOT_IN_TOTAL}.
          </p>
        </Card>
      ) : !hasAny ? (
        <Card className="grid justify-items-start gap-3">
          <p className="font-semibold">Track your first investment</p>
          <p className="text-sm text-muted-foreground">
            Search a share, ETF or mutual fund, enter your units and buy price, and see its value and profit at the last closing price.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={add}>
              <Plus aria-hidden="true" />
              Add holding
            </Button>
            <Button variant="secondary" onClick={addDeposit}>
              <Plus aria-hidden="true" />
              Add fixed deposit
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {PRICES_NOTE} {NOT_IN_TOTAL}.
          </p>
        </Card>
      ) : (
        <>
          <Summary
            totals={totals}
            note={
              <>
                <span className="font-semibold text-ink">{pricesAsOfText(newest(groups.map((g) => g.instrument.priceDate)))}</span> · {PRICES_NOTE}
                {tab === "all" && view.deposits.length > 0 && ` ${FD_NOTE}`} {NOT_IN_TOTAL}.
              </>
            }
          />
          {tab === "all" && <CategoryTable view={view} />}
          {groups.length > 0 && (
            <section aria-labelledby="holdings-title" className="mt-5 grid gap-2">
              <h2 id="holdings-title" className="font-heading text-xl font-bold">
                Holdings
              </h2>
              <Card className="px-0 py-1 md:px-0 md:py-1">
                <div aria-hidden="true" className={cn("hidden gap-3 border-b border-line px-5 py-2 text-xs font-semibold text-muted-foreground md:grid", COLUMNS)}>
                  <span>Name</span>
                  <span className="text-right">Units</span>
                  <span className="text-right">{labels.average}</span>
                  <span className="text-right">{labels.last}</span>
                  <span className="text-right">Value</span>
                  <span className="text-right">Profit or loss</span>
                </div>
                <ul>
                  {groups.map((group) => (
                    <GroupRow
                      key={group.instrument.id}
                      group={group}
                      labels={tab === "all" && group.instrument.kind === "fund" ? NAV_LABELS : labels}
                      onOpen={(kind, item) => setOpen({ kind, item })}
                    />
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </>
      )}

      {archivedCount > 0 && (
        <div className="mt-3">
          <Button variant="link" aria-expanded={showArchived} onClick={() => setShowArchived((s) => !s)}>
            {showArchived ? "Hide" : "Show"} archived ({archivedCount})
          </Button>
          {showArchived && (
            <Card className="mt-2 py-1 md:py-1">
              <ul>
                {view.archived.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2.5 last:border-b-0">
                    <div className="grid min-w-0 flex-1 basis-60 gap-0.5">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                        <span className="truncate">{item.instrument.name}</span>
                        <KindChip kind={item.instrument.kind} />
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatUnits(item.unitsScaled)} units at {formatPriceScaled(item.buyPriceScaled)} · bought {fullDate(item.buyDate)} · invested {money(item.figures.investedMinor, "INR")}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-0.5">
                      <Button variant="ghost" size="sm" disabled={busy} aria-label={`Restore ${recordName(item)}`} onClick={() => restore(item)}>
                        Restore
                      </Button>
                      <Button variant="ghost" size="sm" className="text-danger" aria-label={`Delete ${recordName(item)} permanently`} onClick={() => setOpen({ kind: "delete", item })}>
                        Delete permanently
                      </Button>
                    </div>
                  </li>
                ))}
                {view.archivedDeposits.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2.5 last:border-b-0">
                    <div className="grid min-w-0 flex-1 basis-60 gap-0.5">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                        <span className="truncate">{d.label ?? d.bank}</span>
                        <Badge tone="neutral">Fixed deposit</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {d.label ? `${d.bank} · ` : ""}
                        {money(d.principalMinor, "INR")} at {formatPercentFromBasisPoints(d.rateBps, { maximumFractionDigits: 2 })} · {fullDate(d.startDate)} to {fullDate(d.maturityDate)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-0.5">
                      <Button variant="ghost" size="sm" disabled={busy} aria-label={`Restore fixed deposit ${depositName(d)}`} onClick={() => restoreDeposit(d)}>
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        aria-label={`Delete fixed deposit ${depositName(d)} permanently`}
                        onClick={() => setOpen({ kind: "deleteDeposit", deposit: d })}
                      >
                        Delete permanently
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <Dialog open={open !== null} onOpenChange={(o) => !o && close()}>
        {(open?.kind === "add" || open?.kind === "edit") && (
          <DialogContent
            eyebrow="Investments"
            title={open.kind === "add" ? (tabKind?.add ?? "Add holding") : `Edit ${open.item.instrument.name}`}
            description={open.kind === "add" ? DIALOG_DESCRIPTION[tabKind?.kind ?? "any"] : "The fund or share stays the same; change the units, price or date."}
            className="flex max-h-dvh flex-col md:max-h-[calc(100dvh-2rem)] md:max-w-[600px]"
          >
            <HoldingForm today={view.today} item={open.kind === "edit" ? open.item : undefined} kind={open.kind === "add" ? tabKind?.kind : undefined} onDone={close} />
          </DialogContent>
        )}
        {open?.kind === "archive" && (
          <DialogContent eyebrow="Investments" title={`Archive this holding?`} description={`${recordName(open.item)}. It moves to Archived and leaves the totals. You can restore it later.`}>
            <ConfirmAction
              label="Archive"
              pendingLabel="Archiving…"
              action={() => setHoldingArchivedAction({ holdingId: open.item.id, archived: true })}
              onDone={close}
            />
          </DialogContent>
        )}
        {open?.kind === "delete" && (
          <DialogContent
            eyebrow="Investments"
            title={`Delete this holding permanently?`}
            description={`${recordName(open.item)}. The record is removed for good. This can't be undone. Your accounts and transactions don't change.`}
          >
            <ConfirmAction label="Delete permanently" pendingLabel="Deleting…" destructive action={() => deleteHoldingAction({ holdingId: open.item.id })} onDone={close} />
          </DialogContent>
        )}
        {(open?.kind === "addDeposit" || open?.kind === "editDeposit") && (
          <DialogContent
            eyebrow="Investments"
            title={open.kind === "addDeposit" ? "Add fixed deposit" : `Edit ${open.deposit.label ?? open.deposit.bank}`}
            description="Use the figures on your deposit receipt."
            className="flex max-h-dvh flex-col md:max-h-[calc(100dvh-2rem)] md:max-w-[640px]"
          >
            <DepositForm today={view.today} item={open.kind === "editDeposit" ? open.deposit : undefined} onDone={close} />
          </DialogContent>
        )}
        {open?.kind === "archiveDeposit" && (
          <DialogContent eyebrow="Investments" title="Archive this fixed deposit?" description={`${depositName(open.deposit)}. It moves to Archived and leaves the totals. You can restore it later.`}>
            <ConfirmAction
              label="Archive"
              pendingLabel="Archiving…"
              action={() => setFixedDepositArchivedAction({ depositId: open.deposit.id, archived: true })}
              onDone={close}
            />
          </DialogContent>
        )}
        {open?.kind === "deleteDeposit" && (
          <DialogContent
            eyebrow="Investments"
            title="Delete this fixed deposit permanently?"
            description={`${depositName(open.deposit)}. The record is removed for good. This can't be undone. Your accounts and transactions don't change.`}
          >
            <ConfirmAction label="Delete permanently" pendingLabel="Deleting…" destructive action={() => deleteFixedDepositAction({ depositId: open.deposit.id })} onDone={close} />
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

function TabBar({ current }: { current: InvestmentTab }) {
  return (
    <nav aria-label="Investment types" className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max gap-0.5 rounded-lg bg-canvas p-0.5">
        {INVESTMENT_TABS.map((t) => (
          <li key={t.value}>
            <Link
              href={t.value === "all" ? "/investments" : `/investments?tab=${t.value}`}
              aria-current={t.value === current ? "page" : undefined}
              scroll={false}
              className={cn(
                "flex h-[32px] items-center rounded-md px-3 text-sm font-semibold whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-ring",
                t.value === current ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-ink"
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Summary({
  totals,
  note,
  valueLabel = "Current value",
  profitLabel = "Profit or loss",
}: {
  totals: PortfolioTotals
  note: React.ReactNode
  valueLabel?: string
  profitLabel?: string
}) {
  const stat = "grid content-start gap-0.5"
  const label = "text-xs font-semibold text-muted-foreground"
  return (
    <Card role="region" aria-label="Summary" className="grid gap-3 py-3 md:py-3.5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:flex-wrap md:items-start md:gap-x-10">
        <div className={stat}>
          <dt className={label}>Invested</dt>
          <dd className="font-heading text-lg font-bold tabular-nums md:text-xl">{money(totals.investedMinor, "INR")}</dd>
        </div>
        <div className={stat}>
          <dt className={label}>{valueLabel}</dt>
          <dd className="font-heading text-lg font-bold tabular-nums md:text-xl">{money(totals.valueMinor, "INR")}</dd>
        </div>
        <div className={cn(stat, "col-span-2")}>
          <dt className={label}>{profitLabel}</dt>
          <dd>
            <ProfitText minor={totals.profitMinor} bps={totals.profitBps} size="lg" />
          </dd>
        </div>
      </dl>
      <p className="border-t border-line pt-2 text-xs text-muted-foreground">{note}</p>
    </Card>
  )
}

function DepositList({ deposits, onOpen }: { deposits: DepositItem[]; onOpen: (kind: "editDeposit" | "archiveDeposit", deposit: DepositItem) => void }) {
  const cell = "grid gap-0.5 md:block md:text-right"
  const cellLabel = "text-xs text-muted-foreground md:sr-only"
  return (
    <section aria-labelledby="deposits-title" className="mt-5 grid gap-2">
      <h2 id="deposits-title" className="font-heading text-xl font-bold">
        Fixed deposits
      </h2>
      <Card className="px-0 py-1 md:px-0 md:py-1">
        <div aria-hidden="true" className={cn("hidden gap-3 border-b border-line px-5 py-2 text-xs font-semibold text-muted-foreground md:grid", DEPOSIT_COLUMNS)}>
          <span>Bank</span>
          <span className="text-right">Principal</span>
          <span className="text-right">Rate</span>
          <span className="text-right">Start</span>
          <span className="text-right">Maturity</span>
          <span className="text-right">Maturity value</span>
          <span className="text-right">Worth today</span>
          <span className="text-right">Days left</span>
          <span className="sr-only">Actions</span>
        </div>
        <ul>
          {deposits.map((d) => (
            <li key={d.id} className={cn("grid grid-cols-2 items-start gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 last:border-b-0 md:items-center md:px-5", DEPOSIT_COLUMNS)}>
              <div className="col-span-2 min-w-0 md:col-span-1">
                <p className="text-sm font-semibold">{d.label ?? d.bank}</p>
                {d.label && <p className="text-xs text-muted-foreground">{d.bank}</p>}
              </div>
              <div className={cell}>
                <span className={cellLabel}>Principal</span>
                <span className="text-sm tabular-nums">{money(d.principalMinor, "INR")}</span>
              </div>
              <div className={cell}>
                <span className={cellLabel}>Rate</span>
                <span className="text-sm tabular-nums">{formatPercentFromBasisPoints(d.rateBps, { maximumFractionDigits: 2 })}</span>
                <span className="block text-xs text-muted-foreground">{COMPOUNDING_LABEL[d.compounding]}</span>
              </div>
              <div className={cell}>
                <span className={cellLabel}>Start</span>
                <span className="text-sm tabular-nums">{fullDate(d.startDate)}</span>
              </div>
              <div className={cell}>
                <span className={cellLabel}>Maturity</span>
                <span className="text-sm tabular-nums">{fullDate(d.maturityDate)}</span>
              </div>
              <div className={cell}>
                <span className={cellLabel}>Maturity value</span>
                <span className="text-sm font-semibold tabular-nums">{money(d.figures.maturityValueMinor, "INR")}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">+{money(d.figures.interestMinor, "INR")} interest</span>
              </div>
              <div className={cell}>
                <span className={cellLabel}>Worth today</span>
                <span className="text-sm tabular-nums">{money(d.figures.accruedValueMinor, "INR")}</span>
              </div>
              <div className={cell}>
                <span className={cellLabel}>Days left</span>
                {d.figures.matured ? <Badge tone="positive">Matured</Badge> : <span className="text-sm tabular-nums">{d.figures.daysLeft} days</span>}
              </div>
              <div className="col-span-2 -mr-2 flex justify-end gap-0.5 md:col-span-1">
                <Button variant="ghost" size="sm" aria-label={`Edit fixed deposit ${depositName(d)}`} onClick={() => onOpen("editDeposit", d)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" aria-label={`Archive fixed deposit ${depositName(d)}`} onClick={() => onOpen("archiveDeposit", d)}>
                  Archive
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}

/** All tab: invested, value and profit or loss per category. */
function CategoryTable({ view }: { view: InvestmentsView }) {
  const cell = "px-3 py-2 text-right tabular-nums first:pl-4 first:text-left last:pr-4 md:first:pl-5 md:last:pr-5"
  return (
    <Card className="mt-3 overflow-x-auto px-0 py-1 md:px-0 md:py-1">
      <table className="w-full min-w-[520px] text-sm">
        <caption className="sr-only">By category</caption>
        <thead>
          <tr className="border-b border-line text-xs text-muted-foreground">
            {["Category", "Invested", "Value", "Profit or loss"].map((h) => (
              <th key={h} scope="col" className={cn(cell, "font-semibold")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.categories.map((c) => (
            <tr key={c.category} className="border-b border-line last:border-b-0">
              <th scope="row" className={cn(cell, "font-semibold")}>
                {CATEGORY_LABEL[c.category]}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">{c.count === 0 ? "none" : c.count}</span>
              </th>
              <td className={cell}>{c.count === 0 ? "—" : money(c.totals.investedMinor, "INR")}</td>
              <td className={cell}>{c.count === 0 ? "—" : money(c.totals.valueMinor, "INR")}</td>
              <td className={cell}>{c.count === 0 ? "—" : <ProfitText minor={c.totals.profitMinor} bps={c.totals.profitBps} />}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <th scope="row" className={cn(cell, "font-semibold")}>
              Total
            </th>
            <td className={cn(cell, "font-semibold")}>{money(view.totals.investedMinor, "INR")}</td>
            <td className={cn(cell, "font-semibold")}>{money(view.totals.valueMinor, "INR")}</td>
            <td className={cell}>
              <ProfitText minor={view.totals.profitMinor} bps={view.totals.profitBps} />
            </td>
          </tr>
        </tfoot>
      </table>
    </Card>
  )
}

function GroupRow({ group, labels, onOpen }: { group: HoldingGroup; labels: Labels; onOpen: (kind: "edit" | "archive", item: HoldingItem) => void }) {
  const [expanded, setExpanded] = useState(false)
  const { instrument, figures } = group
  const id = `group-${instrument.id}`
  const cell = "grid gap-0.5 md:block md:text-right"
  const cellLabel = "text-xs text-muted-foreground md:sr-only"
  return (
    <li className="border-b border-line last:border-b-0">
      <div className={cn("grid grid-cols-2 items-start gap-x-3 gap-y-2 px-4 py-2.5 md:items-center md:px-5", COLUMNS)}>
        <div className="col-span-2 min-w-0 md:col-span-1">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded((e) => !e)}
            className="-mx-1 flex max-w-full items-start gap-1 rounded-md px-1 text-left outline-none focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronDown aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{instrument.name}</span>
              <span className="block text-xs text-muted-foreground">
                {instrument.source === "bse" ? "BSE" : "AMFI"} {instrument.sourceCode}
                {instrument.symbol ? ` · ${instrument.symbol}` : ""} · {group.records.length} {group.records.length === 1 ? "record" : "records"}
              </span>
            </span>
          </button>
          <div className="mt-1 flex flex-wrap gap-1 pl-5">
            <KindChip kind={instrument.kind} />
            <GroupBadges group={group} />
          </div>
        </div>
        <div className={cell}>
          <span className={cellLabel}>Units</span>
          <span className="text-sm tabular-nums">{formatUnits(group.totalUnitsScaled)}</span>
        </div>
        <div className={cell}>
          <span className={cellLabel}>{labels.average}</span>
          <span className="text-sm tabular-nums">{formatPriceScaled(group.averageBuyPriceScaled)}</span>
        </div>
        <div className={cell}>
          <span className={cellLabel}>{labels.last}</span>
          <span className="text-sm tabular-nums">{formatPriceScaled(instrument.lastPriceScaled)}</span>
          <span className="block text-xs text-muted-foreground">
            {priceLabel(instrument.source)} {fullDate(instrument.priceDate)}
          </span>
        </div>
        <div className={cell}>
          <span className={cellLabel}>Value</span>
          <span className="text-sm font-semibold tabular-nums">{figures.valueMinor !== null ? money(figures.valueMinor, "INR") : "—"}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">of {money(figures.investedMinor, "INR")}</span>
        </div>
        <div className={cell}>
          <span className={cellLabel}>Profit or loss</span>
          {figures.profitMinor !== null && <ProfitText minor={figures.profitMinor} bps={figures.profitBps} />}
        </div>
      </div>

      {expanded && (
        <ul id={id} aria-label={`Records of ${instrument.name}`} className="mx-4 mb-3 grid rounded-xl bg-canvas px-3 py-1 md:mx-5">
          {group.records.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-2 last:border-b-0">
              <div className="grid min-w-0 flex-1 basis-56 gap-0.5 text-sm tabular-nums">
                <p>
                  <span className="font-semibold">{formatUnits(item.unitsScaled)} units</span> at {formatPriceScaled(item.buyPriceScaled)}
                  <span className="text-muted-foreground"> · bought {fullDate(item.buyDate)}</span>
                </p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  Invested {money(item.figures.investedMinor, "INR")}
                  {item.figures.profitMinor !== null && <ProfitText minor={item.figures.profitMinor} bps={item.figures.profitBps} className="text-xs" />}
                  {item.identifierChanged && <Badge tone="negative">Identifier changed, check your units</Badge>}
                </p>
              </div>
              <div className="-mr-2 flex shrink-0 gap-0.5">
                <Button variant="ghost" size="sm" aria-label={`Edit ${recordName(item)}`} onClick={() => onOpen("edit", item)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" aria-label={`Archive ${recordName(item)}`} onClick={() => onOpen("archive", item)}>
                  Archive
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function ConfirmAction({
  label,
  pendingLabel,
  destructive = false,
  action,
  onDone,
}: {
  label: string
  pendingLabel: string
  destructive?: boolean
  action: () => Promise<WriteResult>
  onDone: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  async function go() {
    if (pending) return
    setPending(true)
    const result = await run(action)
    setPending(false)
    if (result.status === "success") {
      toast.success(result.message)
      onDone()
    } else setError(result.message)
  }
  return (
    <div className="grid gap-4">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className="flex flex-wrap justify-end gap-2">
        <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
        <Button type="button" variant={destructive ? "destructive" : "primary"} size="lg" disabled={pending} aria-busy={pending} onClick={go}>
          {pending ? pendingLabel : label}
        </Button>
      </div>
    </div>
  )
}

export function InvestmentsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading investments">
      <PageHeader {...INVESTMENTS_HEADER} />
      <Card className="grid gap-3">
        <span className="h-6 w-64 rounded bg-canvas" />
        <span className="h-4 w-80 rounded bg-canvas" />
      </Card>
      <Card className="mt-5 grid gap-3">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-10 w-full rounded-lg bg-canvas" />
        ))}
      </Card>
    </div>
  )
}
