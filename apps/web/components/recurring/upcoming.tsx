"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, CircleAlert } from "lucide-react"
import { type EntryType, type LedgerAccount, type LedgerCategory, type Lookup, type RecurringItem, type RecurringView, UPCOMING_DAYS } from "@fin-creador/api"
import type { IsoDate } from "@fin-creador/domain"
import { cn } from "cn"
import { EntryIcon, accountChipText, dayHeading, entryKindLabel, entryTitle, fullDate, signedAmount } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { type RecurringDialog, RecurringDialogs } from "./dialogs"

/** A rule's row: icon, title, schedule, account, amount and date, then the actions given. */
export function RecurringRow({ item, lookup, today, children }: { item: RecurringItem; lookup: Lookup; today: IsoDate; children?: React.ReactNode }) {
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
            {item.kind === "ended" ? (item.date ? `Ended ${fullDate(item.date)}` : "Ended") : item.kind === "archived" ? "Archived" : item.date ? dayHeading(item.date, today) : ""}
          </p>
        </div>
        {children && <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">{children}</div>}
      </div>
    </li>
  )
}

/** A titled panel with a count, its own list and its own empty state (the Recurring page). */
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
 * The compact Upcoming card on the Income page (income only) and the Transactions page (all
 * types): counts, then the first few items (needs attention, due, coming up). Everything
 * else is on /recurring. Nothing is saved until the person confirms.
 */
export function UpcomingCard({
  view,
  lookup,
  today,
  type = null,
  onConfirm,
  limit = 3,
}: {
  view: RecurringView
  lookup: Lookup
  today: IsoDate
  type?: EntryType | null
  onConfirm: (item: RecurringItem) => void
  limit?: number
}) {
  const mine = (items: RecurringItem[]) => items.filter((i) => !type || i.rule.type === type)
  const due = mine(view.due)
  const attention = mine(view.attention)
  const soon = mine(view.soon)
  const shown = [...attention, ...due, ...soon].slice(0, limit)
  const what = type === "income" ? "recurring income" : "recurring items"

  return (
    <Card aria-labelledby="upcoming-title" className="px-0 md:px-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 md:px-6">
        <div>
          <CardTitle id="upcoming-title">Upcoming</CardTitle>
          <CardDescription className="mt-1">
            {due.length} due · {attention.length} {attention.length === 1 ? "needs" : "need"} attention · {soon.length} in the next {UPCOMING_DAYS} days
          </CardDescription>
        </div>
        <Link href="/recurring" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          Open Recurring
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className="px-5 pt-4 pb-1 text-sm text-muted-foreground md:px-6">No {what} due or coming up. Nothing is saved until you confirm it.</p>
      ) : (
        <ul className="mt-4 border-t border-line">
          {shown.map((i) => (
            <RecurringRow key={i.rule.id} item={i} lookup={lookup} today={today}>
              {i.kind === "due" && (
                <Button size="sm" onClick={() => onConfirm(i)} aria-label={`Confirm ${entryTitle(i.entry, lookup)}`}>
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

/** The Upcoming card with its Confirm dialog, for the Income and Transactions pages. */
export function UpcomingSection({
  view,
  accounts,
  cardAccounts = [],
  categories,
  today,
  currency,
  type = null,
}: {
  view: RecurringView
  accounts: LedgerAccount[]
  /** Credit cards: only as "Paid from" for expenses. */
  cardAccounts?: LedgerAccount[]
  categories: LedgerCategory[]
  today: IsoDate
  currency: string
  type?: EntryType | null
}) {
  const [open, setOpen] = useState<RecurringDialog>(null)
  const lookup: Lookup = useMemo(
    () => ({ accounts: new Map([...accounts, ...cardAccounts].map((a) => [a.id, a])), categories: new Map(categories.map((c) => [c.id, c])) }),
    [accounts, cardAccounts, categories]
  )
  return (
    <>
      <UpcomingCard view={view} lookup={lookup} today={today} type={type} onConfirm={(item) => setOpen({ kind: "confirm", item })} />
      <RecurringDialogs
        open={open}
        onClose={() => setOpen(null)}
        titleOf={(item) => entryTitle(item.entry, lookup)}
        accounts={accounts}
        cardAccounts={cardAccounts}
        categories={categories}
        today={today}
        currency={currency}
      />
    </>
  )
}
