"use client"

import { useMemo, useState, useTransition } from "react"
import { Plus } from "lucide-react"
import { type Lookup, type RecurringItem, type RecurringView, type TransactionsContext, UPCOMING_DAYS, showCostTile } from "@fin-creador/api"
import type { CostTotal } from "@fin-creador/domain"
import { setRecurringRuleArchivedAction, undoSkipAction } from "@/app/(app)/recurring/actions"
import { StatCard } from "@/components/income/stat-card"
import { PageHeader } from "@/components/shell/app-shell"
import { entryTitle, fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { toast } from "@/components/ui/toast"
import { type RecurringDialog, RecurringDialogs } from "./dialogs"
import { RecurringPanel, RecurringRow } from "./upcoming"

export const RECURRING_HEADER = {
  eyebrow: "Money activity",
  title: "Recurring",
  description: "Salary, rent, subscriptions and other repeating items. Nothing is saved until you confirm it.",
}

/** The Recurring page (Sprint 4): cost tiles, status panels, groups and archived rules. */
export function RecurringPageView({ context, view }: { context: TransactionsContext; view: RecurringView }) {
  const [open, setOpen] = useState<RecurringDialog>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [busy, startBusy] = useTransition()
  const { today, currency } = context
  const lookup: Lookup = useMemo(
    () => ({ accounts: new Map(context.accounts.map((a) => [a.id, a])), categories: new Map(context.categories.map((c) => [c.id, c])) }),
    [context.accounts, context.categories]
  )
  const title = (i: RecurringItem) => entryTitle(i.entry, lookup)
  const hasAccounts = context.accounts.some((a) => !a.archived)

  // Quick actions (no dialog): restore and undo skip, with a toast either way.
  const quick = (run: () => Promise<{ status: "success" | "error"; message: string }>) =>
    startBusy(async () => {
      try {
        const result = await run()
        if (result.status === "success") toast.success(result.message)
        else toast.error(result.message)
      } catch {
        toast.error("We couldn't reach the server. Try again.")
      }
    })

  const tile = (label: string, t: CostTotal, cur: string, what: string) => (
    <StatCard
      key={label}
      label={label}
      value={`${money(t.monthlyMinor, cur)} / month`}
      footer={`${money(t.yearlyMinor, cur)} a year · ${t.count} ${t.count === 1 ? what : `${what}s`} · estimated from default amounts`}
    />
  )

  const ruleActions = (i: RecurringItem) => (
    <>
      {i.undoableSkip && (
        <Button variant="ghost" size="sm" disabled={busy} aria-label={`Undo skip of ${title(i)}`} onClick={() => quick(() => undoSkipAction({ ruleId: i.rule.id, occurrenceDate: i.undoableSkip }))}>
          Undo skip
        </Button>
      )}
      <Button variant="ghost" size="sm" aria-label={`Edit ${title(i)}`} onClick={() => setOpen({ kind: "edit", item: i })}>
        Edit
      </Button>
      <Button variant="ghost" size="sm" aria-label={`Archive ${title(i)}`} onClick={() => setOpen({ kind: "archive", item: i })}>
        Archive
      </Button>
    </>
  )

  const status = (i: RecurringItem) =>
    i.kind === "due" ? (
      <Badge tone="info">{i.date && i.date < today ? `Missed ${fullDate(i.date)}` : "Due today"}</Badge>
    ) : i.kind === "needs_attention" ? (
      <Badge tone="negative">Needs attention</Badge>
    ) : i.date ? (
      <Badge tone="neutral">Next {fullDate(i.date)}</Badge>
    ) : null

  const group = (items: RecurringItem[], name: string, empty: string) => (
    <RecurringPanel title={name} count={items.length} empty={empty}>
      {items.map((i) => (
        <RecurringRow key={i.rule.id} item={{ ...i, attention: null }} lookup={lookup} today={today}>
          {status(i)}
          {ruleActions(i)}
        </RecurringRow>
      ))}
    </RecurringPanel>
  )

  return (
    <>
      <PageHeader
        {...RECURRING_HEADER}
        actions={
          hasAccounts && (
            <Button size="lg" onClick={() => setOpen({ kind: "add" })}>
              <Plus aria-hidden="true" />
              Add recurring
            </Button>
          )
        }
      />

      <div className="grid gap-4">
        {!hasAccounts && (
          <Card className="grid justify-items-start gap-2">
            <p className="font-semibold">Add an account first</p>
            <p className="text-sm text-muted-foreground">Recurring items post into an account. Add one on the Income page, then come back.</p>
          </Card>
        )}

        {view.costs.map((c) => {
          const suffix = c.currency === currency ? "" : ` · ${c.currency}`
          const tiles = [
            showCostTile(c, "subscriptions", currency) && tile(`Subscriptions${suffix}`, c.subscriptions, c.currency, "subscription"),
            showCostTile(c, "memberships", currency) && tile(`Memberships${suffix}`, c.memberships, c.currency, "membership"),
            showCostTile(c, "total", currency) && tile(`Total recurring cost${suffix}`, c.total, c.currency, "expense"),
          ].filter(Boolean)
          return (
            <section key={c.currency} aria-label={`Recurring cost in ${c.currency}`} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {tiles}
            </section>
          )
        })}
        <p className="-mt-3 text-xs text-muted-foreground">
          Active recurring expenses only (not income, transfers, ended or archived items). Each currency is totalled on its own; amounts are never converted.
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          <RecurringPanel title="Due" count={view.due.length} description="Confirm to save the entry, or skip this date." empty="Nothing is due.">
            {view.due.map((i) => (
              <RecurringRow key={i.rule.id} item={i} lookup={lookup} today={today}>
                <Button variant="ghost" size="sm" onClick={() => setOpen({ kind: "skip", item: i })} aria-label={`Skip ${title(i)}`}>
                  Skip
                </Button>
                <Button size="sm" onClick={() => setOpen({ kind: "confirm", item: i })} aria-label={`Confirm ${title(i)}`}>
                  Confirm
                </Button>
              </RecurringRow>
            ))}
          </RecurringPanel>
          <RecurringPanel title="Needs attention" count={view.attention.length} description="These can't save until fixed." empty="All recurring items can save.">
            {view.attention.map((i) => (
              <RecurringRow key={i.rule.id} item={i} lookup={lookup} today={today}>
                <Button variant="secondary" size="sm" onClick={() => setOpen({ kind: "edit", item: i })} aria-label={`Fix ${title(i)}`}>
                  Fix
                </Button>
              </RecurringRow>
            ))}
          </RecurringPanel>
          <RecurringPanel title={`Coming in ${UPCOMING_DAYS} days`} count={view.soon.length} empty={`Nothing in the next ${UPCOMING_DAYS} days.`}>
            {view.soon.map((i) => (
              <RecurringRow key={i.rule.id} item={i} lookup={lookup} today={today} />
            ))}
          </RecurringPanel>
          <RecurringPanel title="Ended" count={view.ended.length} description="Past their end date. Their entries stay." empty="No recurring items have ended.">
            {view.ended.map((i) => (
              <RecurringRow key={i.rule.id} item={i} lookup={lookup} today={today}>
                <Button variant="ghost" size="sm" aria-label={`Archive ${title(i)}`} onClick={() => setOpen({ kind: "archive", item: i })}>
                  Archive
                </Button>
              </RecurringRow>
            ))}
          </RecurringPanel>
        </div>

        {group(view.groups.subscription, "Subscriptions", "No subscriptions. Use the Subscription category for streaming, apps and similar.")}
        {group(view.groups.membership, "Memberships", "No memberships. Use the Membership category for clubs, gyms and similar.")}
        {group(view.groups.other, "Other recurring", "No other recurring items.")}

        {view.archived.length > 0 && (
          <div>
            <Button variant="ghost" size="sm" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide archived" : `Show archived (${view.archived.length})`}
            </Button>
            {showArchived && (
              <RecurringPanel title="Archived" count={view.archived.length} empty="" className="mt-2">
                {view.archived.map((i) => (
                  <RecurringRow key={i.rule.id} item={i} lookup={lookup} today={today}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      aria-label={`Restore ${title(i)}`}
                      onClick={() => quick(() => setRecurringRuleArchivedAction({ ruleId: i.rule.id, archived: false }))}
                    >
                      Restore
                    </Button>
                  </RecurringRow>
                ))}
              </RecurringPanel>
            )}
          </div>
        )}
      </div>

      <RecurringDialogs open={open} onClose={() => setOpen(null)} titleOf={title} accounts={context.accounts} categories={context.categories} today={today} currency={currency} />
    </>
  )
}

export function RecurringSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading recurring items">
      <PageHeader {...RECURRING_HEADER} />
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="grid gap-4">
            <span className="h-4 w-28 rounded bg-canvas" />
            <span className="h-9 w-40 rounded bg-canvas" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="grid gap-3">
            <span className="h-5 w-32 rounded bg-canvas" />
            <span className="h-12 w-full rounded-xl bg-canvas" />
          </Card>
        ))}
      </div>
    </div>
  )
}
