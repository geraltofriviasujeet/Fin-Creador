"use client"

import { CalendarClock, CircleAlert } from "lucide-react"
import type { EntryType, LedgerItem, Lookup } from "@fin-creador/api"
import { type IsoDate, addDays } from "@fin-creador/domain"
import { cn } from "cn"
import { EntryIcon, accountChipText, dayHeading, entryKindLabel, entryTitle, signedAmount } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"

/**
 * One recurring rule's place in the Upcoming list. `entry` describes what confirming it
 * would post (the same text helpers as the ledger). Computed in packages/domain.
 */
export type UpcomingItem = {
  ruleId: string
  kind: "due" | "needs_attention" | "upcoming"
  /** The occurrence date (due / upcoming), or the next one for a rule that needs attention. */
  date: IsoDate | null
  schedule: string
  entry: LedgerItem
  /** Why it can't post, for "needs attention". */
  attention?: string
}

/** Coming-up items are listed this many days ahead. */
export const UPCOMING_DAYS = 30

/**
 * Upcoming recurring items, shared by the Income page (income only) and the Transactions
 * page (all types, or the type tab). Nothing posts by itself: due items wait for Confirm
 * or Skip; a rule that needs attention must be fixed first.
 */
export function Upcoming({
  items,
  lookup,
  today,
  type = null,
  onConfirm,
  onSkip,
  onFix,
  onManage,
}: {
  items: UpcomingItem[]
  lookup: Lookup
  today: IsoDate
  type?: EntryType | null
  onConfirm: (ruleId: string) => void
  onSkip: (ruleId: string) => void
  onFix: (ruleId: string) => void
  onManage?: () => void
}) {
  const horizon = addDays(today, UPCOMING_DAYS)
  const shown = items.filter((i) => (!type || i.entry.type === type) && (i.kind !== "upcoming" || (i.date !== null && i.date <= horizon)))
  const attention = shown.filter((i) => i.kind === "needs_attention")
  const due = shown.filter((i) => i.kind === "due").sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
  const soon = shown.filter((i) => i.kind === "upcoming").sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))

  return (
    <Card className="px-0 md:px-0">
      <div className="flex flex-wrap items-end justify-between gap-2 px-5 md:px-6">
        <div>
          <CardTitle>Upcoming</CardTitle>
          <CardDescription className="mt-1">
            Recurring {type ? `${type === "income" ? "income" : `${type}s`}` : "items"} due now and in the next {UPCOMING_DAYS} days. Nothing is saved until you confirm it.
          </CardDescription>
        </div>
        {onManage && (
          <Button variant="secondary" size="sm" onClick={onManage}>
            Manage recurring
          </Button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="grid justify-items-center gap-2 px-5 py-10 text-center md:px-6">
          <CalendarClock aria-hidden="true" className="size-6 text-muted-foreground" />
          <p className="font-semibold">Nothing due</p>
          <p className="max-w-md text-sm text-muted-foreground">Add a recurring item (salary, rent, a subscription) and it shows here when it&apos;s due.</p>
        </div>
      ) : (
        <div className="mt-4">
          <Section title="Needs attention" items={attention} lookup={lookup} today={today}>
            {(i) => (
              <Button variant="secondary" size="sm" onClick={() => onFix(i.ruleId)} aria-label={`Fix ${entryTitle(i.entry, lookup)}`}>
                Fix
              </Button>
            )}
          </Section>
          <Section title="Due" items={due} lookup={lookup} today={today}>
            {(i) => (
              <>
                <Button variant="ghost" size="sm" onClick={() => onSkip(i.ruleId)} aria-label={`Skip ${entryTitle(i.entry, lookup)}`}>
                  Skip
                </Button>
                <Button size="sm" onClick={() => onConfirm(i.ruleId)} aria-label={`Confirm ${entryTitle(i.entry, lookup)}`}>
                  Confirm
                </Button>
              </>
            )}
          </Section>
          <Section title={`Coming up · next ${UPCOMING_DAYS} days`} items={soon} lookup={lookup} today={today} />
        </div>
      )}
    </Card>
  )
}

function Section({
  title,
  items,
  lookup,
  today,
  children,
}: {
  title: string
  items: UpcomingItem[]
  lookup: Lookup
  today: IsoDate
  children?: (item: UpcomingItem) => React.ReactNode
}) {
  if (items.length === 0) return null
  const id = `upcoming-${title.split(" ")[0]!.toLowerCase()}`
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="border-y border-line bg-canvas px-5 py-2 text-xs font-semibold tracking-(--fc-tracking-eyebrow) text-muted-foreground uppercase md:px-6">
        {title} ({items.length})
      </h3>
      <ul>
        {items.map((i) => (
          <li key={i.ruleId} className={cn("grid gap-2 border-b border-line px-5 py-3 last:border-b-0 md:flex md:items-center md:gap-4 md:px-6")}>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <EntryIcon entry={i.entry} lookup={lookup} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                  <span className="truncate">{entryTitle(i.entry, lookup)}</span>
                  {i.kind === "needs_attention" && <Badge tone="negative">Needs attention</Badge>}
                  {i.kind === "due" && i.date && i.date < today && <Badge tone="info">Missed</Badge>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {i.schedule} · {entryKindLabel(i.entry, lookup)} · {accountChipText(i.entry, lookup)}
                </p>
                {i.attention && (
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-danger">
                    <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                    {i.attention}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 pl-14 md:pl-0">
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums">{signedAmount(i.entry)}</p>
                <p className="text-xs text-muted-foreground">{i.date ? dayHeading(i.date, today) : "No date"}</p>
              </div>
              {children && <div className="flex shrink-0 items-center gap-1">{children(i)}</div>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
