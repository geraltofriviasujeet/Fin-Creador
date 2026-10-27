"use client"

import { useState, useTransition } from "react"
import { ChevronDown, Plus } from "lucide-react"
import type { HoldingGroup, HoldingItem, InvestmentsView, WriteResult } from "@fin-creador/api"
import { formatPriceScaled, formatUnits } from "@fin-creador/domain"
import { cn } from "cn"
import { deleteHoldingAction, setHoldingArchivedAction } from "@/app/(app)/investments/actions"
import { PageHeader } from "@/components/shell/app-shell"
import { fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { FormMessage } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { GroupBadges, INVESTMENTS_HEADER, KindChip, NOT_IN_TOTAL, PRICES_NOTE, ProfitText, priceLabel, pricesAsOfText, unpricedNote } from "./display"
import { HoldingForm } from "./holding-form"

type Open = { kind: "add" } | { kind: "edit" | "archive" | "delete"; item: HoldingItem } | null

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

/** The Investments page (Sprint 7): a holdings tracker, not linked to accounts. */
export function InvestmentsPageView({ view }: { view: InvestmentsView }) {
  const [open, setOpen] = useState<Open>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [busy, startBusy] = useTransition()
  const close = () => setOpen(null)
  const add = () => setOpen({ kind: "add" })
  const note = unpricedNote(view.totals)

  const restore = (item: HoldingItem) =>
    startBusy(async () => {
      const result = await run(() => setHoldingArchivedAction({ holdingId: item.id, archived: false }))
      if (result.status === "success") toast.success(result.message)
      else toast.error(result.message)
    })

  return (
    <>
      <PageHeader
        {...INVESTMENTS_HEADER}
        actions={
          <Button size="lg" onClick={add}>
            <Plus aria-hidden="true" />
            Add holding
          </Button>
        }
      />

      {view.groups.length === 0 ? (
        <Card className="grid justify-items-start gap-3">
          <p className="font-semibold">Track your first investment</p>
          <p className="text-sm text-muted-foreground">
            Search a share, ETF or mutual fund, enter your units and buy price, and see its value and profit at the last closing price.
          </p>
          <Button variant="secondary" onClick={add}>
            <Plus aria-hidden="true" />
            Add holding
          </Button>
          <p className="text-xs text-muted-foreground">
            {PRICES_NOTE} {NOT_IN_TOTAL}.
          </p>
        </Card>
      ) : (
        <>
          <Summary view={view} />
          {note && (
            <FormMessage tone="info" className="mt-3">
              {note}
            </FormMessage>
          )}
          <section aria-labelledby="holdings-title" className="mt-5 grid gap-2">
            <h2 id="holdings-title" className="font-heading text-xl font-bold">
              Holdings
            </h2>
            <Card className="px-0 py-1 md:px-0 md:py-1">
              <div aria-hidden="true" className={cn("hidden gap-3 border-b border-line px-5 py-2 text-xs font-semibold text-muted-foreground md:grid", COLUMNS)}>
                <span>Name</span>
                <span className="text-right">Units</span>
                <span className="text-right">Avg. buy price</span>
                <span className="text-right">Last price</span>
                <span className="text-right">Value</span>
                <span className="text-right">Profit or loss</span>
              </div>
              <ul>
                {view.groups.map((group) => (
                  <GroupRow key={group.instrument.id} group={group} onOpen={(kind, item) => setOpen({ kind, item })} />
                ))}
              </ul>
            </Card>
          </section>
        </>
      )}

      {view.archived.length > 0 && (
        <div className="mt-3">
          <Button variant="link" aria-expanded={showArchived} onClick={() => setShowArchived((s) => !s)}>
            {showArchived ? "Hide" : "Show"} archived ({view.archived.length})
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
              </ul>
            </Card>
          )}
        </div>
      )}

      <Dialog open={open !== null} onOpenChange={(o) => !o && close()}>
        {(open?.kind === "add" || open?.kind === "edit") && (
          <DialogContent
            eyebrow="Investments"
            title={open.kind === "add" ? "Add holding" : `Edit ${open.item.instrument.name}`}
            description={open.kind === "add" ? "Search the fund or share, then enter what you bought." : "The fund or share stays the same; change the units, price or date."}
            className="flex max-h-dvh flex-col md:max-h-[calc(100dvh-2rem)] md:max-w-[600px]"
          >
            <HoldingForm today={view.today} item={open.kind === "edit" ? open.item : undefined} onDone={close} />
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
      </Dialog>
    </>
  )
}

function Summary({ view }: { view: InvestmentsView }) {
  const { totals } = view
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
          <dt className={label}>Current value</dt>
          <dd className="font-heading text-lg font-bold tabular-nums md:text-xl">{totals.pricedCount > 0 ? money(totals.valueMinor, "INR") : "—"}</dd>
        </div>
        <div className={cn(stat, "col-span-2")}>
          <dt className={label}>Profit or loss</dt>
          <dd>{totals.pricedCount > 0 ? <ProfitText minor={totals.profitMinor} bps={totals.profitBps} size="lg" /> : <span className="text-sm text-muted-foreground">No current prices</span>}</dd>
        </div>
      </dl>
      <p className="border-t border-line pt-2 text-xs text-muted-foreground">
        <span className="font-semibold text-ink">{pricesAsOfText(view.pricesAsOf)}</span> · {PRICES_NOTE} {NOT_IN_TOTAL}.
      </p>
    </Card>
  )
}

function GroupRow({ group, onOpen }: { group: HoldingGroup; onOpen: (kind: "edit" | "archive", item: HoldingItem) => void }) {
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
          <span className={cellLabel}>Avg. buy price</span>
          <span className="text-sm tabular-nums">{formatPriceScaled(group.averageBuyPriceScaled)}</span>
        </div>
        <div className={cell}>
          <span className={cellLabel}>Last price</span>
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
          {figures.profitMinor !== null ? <ProfitText minor={figures.profitMinor} bps={figures.profitBps} /> : <span className="text-xs text-muted-foreground">Not counted</span>}
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
