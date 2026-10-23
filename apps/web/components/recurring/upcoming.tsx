"use client"

import Link from "next/link"
import { ArrowRight, CircleAlert } from "lucide-react"
import type { EntryType, LedgerItem, Lookup } from "@fin-creador/api"
import { type IsoDate, addDays } from "@fin-creador/domain"
import { cn } from "cn"
import { EntryIcon, accountChipText, dayHeading, entryKindLabel, entryTitle, fullDate, signedAmount } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"

/** Coming-up items are listed this many days ahead (owner, 2026-10-23). */
export const UPCOMING_DAYS = 30

/**
 * One recurring rule's place in the lists. `entry` describes what confirming it would post
 * (the same text helpers as the ledger). Computed in packages/domain.
 */
export type UpcomingItem = {
  ruleId: string
  kind: "due" | "needs_attention" | "upcoming" | "ended"
  /** The occurrence date: due, upcoming, or for "needs attention" the one waiting. Null once ended. */
  date: IsoDate | null
  schedule: string
  entry: LedgerItem
  /** Why it can't post, for "needs attention". */
  attention?: string
}

/** Within the next UPCOMING_DAYS days. */
export const isComingSoon = (item: UpcomingItem, today: IsoDate) =>
  item.kind === "upcoming" && item.date !== null && item.date <= addDays(today, UPCOMING_DAYS)

/** A rule's row: icon, title, schedule, account, amount and date, then the actions given. */
export function RecurringRow({ item, lookup, today, children }: { item: UpcomingItem; lookup: Lookup; today: IsoDate; children?: React.ReactNode }) {
  return (
    <li className="grid gap-2 border-b border-line px-5 py-3 last:border-b-0 md:flex md:items-center md:gap-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <EntryIcon entry={item.entry} lookup={lookup} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
            <span className="truncate">{entryTitle(item.entry, lookup)}</span>
            {item.kind === "needs_attention" && <Badge tone="negative">Needs attention</Badge>}
            {item.kind === "due" && item.date && item.date < today && <Badge tone="info">Missed</Badge>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {item.schedule} · {entryKindLabel(item.entry, lookup)} · {accountChipText(item.entry, lookup)}
          </p>
          {item.attention && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-danger">
              <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              {item.attention}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 pl-14 md:pl-0">
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums">{signedAmount(item.entry)}</p>
          <p className="text-xs text-muted-foreground">
            {item.kind === "ended" ? `Ended ${item.date ? fullDate(item.date) : ""}`.trim() : item.date ? dayHeading(item.date, today) : "No date"}
          </p>
        </div>
        {children && <div className="flex shrink-0 items-center gap-1">{children}</div>}
      </div>
    </li>
  )
}

/** A titled panel with a count, its own list and its own empty state (the /recurring page). */
export function RecurringPanel({
  title,
  description,
  count,
  empty,
  children,
  className,
}: {
  title: string
  description?: string
  count: number
  empty: string
  children: React.ReactNode
  className?: string
}) {
  const id = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  return (
    <Card aria-labelledby={id} className={cn("px-0 md:px-0", className)}>
      <div className="px-5 md:px-6">
        <CardTitle id={id}>
          {title} <span className="text-muted-foreground">({count})</span>
        </CardTitle>
        {description && <CardDescription className="mt-1">{description}</CardDescription>}
      </div>
      {count === 0 ? <p className="px-5 pt-4 pb-1 text-sm text-muted-foreground md:px-6">{empty}</p> : <ul className="mt-4 border-t border-line">{children}</ul>}
    </Card>
  )
}

/**
 * The compact Upcoming card on the Income page (income only) and the Transactions page (the
 * type tab). Due and needs-attention first, then the next few; everything else is on
 * /recurring. Nothing posts by itself.
 */
export function UpcomingCard({
  items,
  lookup,
  today,
  type = null,
  href,
  onConfirm,
  limit = 3,
}: {
  items: UpcomingItem[]
  lookup: Lookup
  today: IsoDate
  type?: EntryType | null
  href: string
  onConfirm: (ruleId: string) => void
  limit?: number
}) {
  const mine = items.filter((i) => !type || i.entry.type === type)
  const due = mine.filter((i) => i.kind === "due")
  const attention = mine.filter((i) => i.kind === "needs_attention")
  const soon = mine.filter((i) => isComingSoon(i, today))
  const byDate = (a: UpcomingItem, b: UpcomingItem) => (a.date ?? "").localeCompare(b.date ?? "")
  const shown = [...attention, ...due.sort(byDate), ...soon.sort(byDate)].slice(0, limit)
  const what = type === "income" ? "recurring income" : type ? `recurring ${type}s` : "recurring items"

  return (
    <Card className="px-0 md:px-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 md:px-6">
        <div>
          <CardTitle>Upcoming</CardTitle>
          <CardDescription className="mt-1">
            {due.length} due · {attention.length} need attention · {soon.length} in the next {UPCOMING_DAYS} days
          </CardDescription>
        </div>
        <Link href={href} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          Open Recurring
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className="px-5 pt-4 pb-1 text-sm text-muted-foreground md:px-6">No {what} due or coming up. Nothing is saved until you confirm it.</p>
      ) : (
        <ul className="mt-4 border-t border-line">
          {shown.map((i) => (
            <RecurringRow key={i.ruleId} item={i} lookup={lookup} today={today}>
              {i.kind === "due" && (
                <Button size="sm" onClick={() => onConfirm(i.ruleId)} aria-label={`Confirm ${entryTitle(i.entry, lookup)}`}>
                  Confirm
                </Button>
              )}
            </RecurringRow>
          ))}
        </ul>
      )}
    </Card>
  )
}
