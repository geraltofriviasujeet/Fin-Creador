"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { FlaskConical, Plus } from "lucide-react"
import type { LedgerItem, Lookup } from "@fin-creador/api"
import {
  type CostTotal,
  type IsoDate,
  latestOccurrenceOnOrBefore,
  recurringCosts,
  recurringStatus,
  scheduleText,
} from "@fin-creador/domain"
import { cn } from "cn"
import { StatCard } from "@/components/income/stat-card"
import { RecurringPanel, RecurringRow, UPCOMING_DAYS, UpcomingCard, type UpcomingItem, isComingSoon } from "@/components/recurring/upcoming"
import { PageHeader } from "@/components/shell/app-shell"
import { TYPE_NOUN, entryTitle, fullDate, money } from "@/components/transactions/display"
import { TransactionForm } from "@/components/transactions/transaction-form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import { type DemoData, type DemoRule, createDemoData } from "./demo-data"
import { Confirmation, RuleForm, SkipForm, StatusBadge } from "./dialogs"

type View = "recurring" | "transactions" | "income"
type Open =
  | { kind: "add" }
  | { kind: "edit" | "confirm" | "skip" | "archive"; ruleId: string }
  | { kind: "void"; ruleId: string; date: IsoDate }
  | null

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Reads the URL; remounts the prototype when the demo state changes (fresh demo data). */
export function RecurringPrototype({ today }: { today: IsoDate }) {
  const params = useSearchParams()
  const empty = params.get("demo") === "empty"
  const raw = params.get("view")
  const view: View = raw === "transactions" || raw === "income" ? raw : "recurring"
  return <Prototype key={String(empty)} today={today} empty={empty} view={view} />
}

/** What confirming a rule's occurrence would post, as a ledger entry (for the shared text helpers). */
function asEntry(rule: DemoRule, date: IsoDate | null): LedgerItem {
  return {
    id: `${rule.id}:${date ?? ""}`,
    type: rule.type,
    amountMinor: rule.amountMinor,
    currency: rule.currency,
    occurredOn: date ?? rule.startDate,
    accountId: rule.accountId,
    counterAccountId: rule.counterAccountId,
    categoryId: rule.categoryId,
    voided: false,
    replacesId: null,
    note: rule.note,
    paymentMode: rule.paymentMode,
    createdAt: "",
    voidReason: null,
  }
}

function Prototype({ today, empty, view }: { today: IsoDate; empty: boolean; view: View }) {
  const pathname = usePathname()
  const [data, setData] = useState<DemoData>(() => createDemoData(today, { empty }))
  const [open, setOpen] = useState<Open>(null)
  const [showArchived, setShowArchived] = useState(false)
  const close = () => setOpen(null)

  const lookup: Lookup = useMemo(
    () => ({ accounts: new Map(data.accounts.map((a) => [a.id, a])), categories: new Map(data.categories.map((c) => [c.id, c])) }),
    [data.accounts, data.categories]
  )
  const rule = (id: string) => data.rules.find((r) => r.id === id)!

  // Why a rule can't post: an archived account or category (decision L).
  const blockedBy = (r: DemoRule): string | null => {
    const archivedAccount = [r.accountId, r.counterAccountId].map((id) => (id ? lookup.accounts.get(id) : undefined)).find((a) => a?.archived)
    if (archivedAccount) return `${archivedAccount.label} is archived. Choose another account to keep this rule posting.`
    const c = r.categoryId ? lookup.categories.get(r.categoryId) : undefined
    if (c?.archived) return `${c.name} is archived. Choose another ${r.type === "income" ? "source" : "category"} to keep this rule posting.`
    return null
  }
  const posted = (r: DemoRule) => data.posts.filter((p) => p.ruleId === r.id && !p.voided)
  const skipped = (r: DemoRule) => data.skips.filter((s) => s.ruleId === r.id)
  // Occurrences already handled: posted (not voided) or skipped.
  const handled = (r: DemoRule) => new Set([...posted(r).map((p) => p.date), ...skipped(r).map((s) => s.date)])
  const statusOf = (r: DemoRule) => recurringStatus({ ...r, blocked: blockedBy(r) !== null }, today, handled(r))
  // Undo a skip only while it is still the latest handled occurrence (owner, 2026-10-23).
  const undoableSkip = (r: DemoRule) => {
    const latestPost = posted(r).map((p) => p.date).sort().at(-1) ?? ""
    const latestSkip = skipped(r).map((s) => s.date).sort().at(-1)
    return latestSkip && latestSkip > latestPost ? latestSkip : null
  }

  const itemOf = (r: DemoRule): UpcomingItem | null => {
    const s = statusOf(r)
    if (s.kind === "archived") return null
    const date = s.kind === "ended" ? (r.endDate ?? latestOccurrenceOnOrBefore(r, today)) : s.date
    return { ruleId: r.id, kind: s.kind, date, schedule: scheduleText(r), entry: asEntry(r, date), attention: blockedBy(r) ?? undefined }
  }
  const items = data.rules.map(itemOf).filter((i): i is UpcomingItem => i !== null)
  const byDate = (a: UpcomingItem, b: UpcomingItem) => (a.date ?? "").localeCompare(b.date ?? "")
  const due = items.filter((i) => i.kind === "due").sort(byDate)
  const attention = items.filter((i) => i.kind === "needs_attention")
  const soon = items.filter((i) => isComingSoon(i, today)).sort(byDate)
  const ended = items.filter((i) => i.kind === "ended")

  // Groups by the category's stable key, so a renamed category stays in its group.
  const groupOf = (r: DemoRule) => (r.categoryId ? data.categories.find((c) => c.id === r.categoryId)?.key : null) ?? "other"
  const active = data.rules.filter((r) => !r.archived)
  const archived = data.rules.filter((r) => r.archived)
  const costs = recurringCosts(
    data.rules.map((r) => {
      const s = statusOf(r).kind
      return { type: r.type, amountMinor: r.amountMinor, currency: r.currency, frequency: r.frequency, group: groupOf(r), active: s !== "ended" && s !== "archived" }
    })
  )

  async function simulate(apply: (d: DemoData) => DemoData, message: string, detail?: string) {
    await wait(600)
    setData(apply)
    close()
    toast.success(message, detail)
    return { ok: true as const }
  }

  const href = (more: Record<string, string>) => {
    const p = new URLSearchParams({ ...(empty ? { demo: "empty" } : {}), ...(view !== "recurring" ? { view } : {}), ...more })
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k)
    const s = p.toString()
    return `${pathname}${s ? `?${s}` : ""}`
  }

  const ruleActions = (r: DemoRule) => {
    const lastPost = posted(r).sort((a, b) => b.date.localeCompare(a.date))[0]
    const skip = undoableSkip(r)
    const title = entryTitle(asEntry(r, null), lookup)
    return (
      <>
        {skip && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Undo skip of ${title}`}
            onClick={() => simulate((d) => ({ ...d, skips: d.skips.filter((s) => !(s.ruleId === r.id && s.date === skip)) }), "Skip undone.", `${fullDate(skip)} is due again.`)}
          >
            Undo skip
          </Button>
        )}
        {lastPost && (
          <Button variant="ghost" size="sm" aria-label={`Void the last entry of ${title}`} onClick={() => setOpen({ kind: "void", ruleId: r.id, date: lastPost.date })}>
            Void last
          </Button>
        )}
        <Button variant="ghost" size="sm" aria-label={`Edit ${title}`} onClick={() => setOpen({ kind: "edit", ruleId: r.id })}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" aria-label={`Archive ${title}`} onClick={() => setOpen({ kind: "archive", ruleId: r.id })}>
          Archive
        </Button>
      </>
    )
  }

  const groupPanel = (group: "subscription" | "membership" | "other", title: string, emptyText: string) => {
    const rules = active.filter((r) => groupOf(r) === group)
    return (
      <RecurringPanel title={title} count={rules.length} empty={emptyText}>
        {rules.map((r) => (
          <RecurringRow key={r.id} item={{ ...itemOf(r)!, attention: undefined }} lookup={lookup} today={today}>
            <StatusBadge status={statusOf(r)} today={today} />
            {ruleActions(r)}
          </RecurringRow>
        ))}
      </RecurringPanel>
    )
  }

  const demoBar = (
    <div role="note" className="mb-6 grid gap-3 rounded-xl border border-dashed border-line-strong bg-chip-blue px-4 py-3 text-sm">
      <p className="flex items-start gap-3">
        <FlaskConical aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <span>
          <strong className="font-semibold">Demo data.</strong> Development-only prototype of Sprint 4 recurring items. Every account, rule and
          entry here is made up and kept in memory; nothing is saved, and reloading starts again.
        </span>
      </p>
      <nav aria-label="Prototype views" className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-8 text-xs font-semibold">
        <span className="text-muted-foreground">View:</span>
        {(
          [
            ["recurring", "Recurring page"],
            ["transactions", "Upcoming card on Transactions"],
            ["income", "Upcoming card on Income"],
          ] as const
        ).map(([v, label]) => (
          <Link
            key={v}
            href={href({ view: v === "recurring" ? "" : v })}
            aria-current={v === view ? "page" : undefined}
            className={cn("rounded-md px-2 py-1", v === view ? "bg-ink text-white" : "underline underline-offset-4")}
          >
            {label}
          </Link>
        ))}
        <Link href={href({ demo: empty ? "" : "empty" })} className="underline underline-offset-4">
          {empty ? "With rules" : "No rules"}
        </Link>
        <button
          type="button"
          className="underline underline-offset-4"
          onClick={() => {
            setData(createDemoData(today, { empty }))
            toast.info("Demo data reset.")
          }}
        >
          Reset demo data
        </button>
      </nav>
    </div>
  )

  const confirmDialog = () => {
    if (open?.kind !== "confirm") return null
    const r = rule(open.ruleId)
    const date = latestOccurrenceOnOrBefore(r, today)!
    return (
      <DialogContent eyebrow={`Recurring · ${fullDate(date)}`} title={`Add ${TYPE_NOUN[r.type]}`} description={`${scheduleText(r)}. Check the details; the category comes from the rule.`}>
        <TransactionForm
          mode={{ kind: "add", type: r.type, locked: true, prefill: asEntry(r, date) }}
          accounts={data.accounts}
          categories={data.categories}
          today={today}
          onSave={async (draft) => {
            await wait(600)
            // The database posts a rule's occurrence at most once among non-voided entries.
            if (data.posts.some((p) => p.ruleId === r.id && p.date === date && !p.voided)) {
              return { ok: false, message: "This occurrence was already saved. Close and check Recurring." }
            }
            setData((d) => ({ ...d, posts: [...d.posts, { ruleId: r.id, date, amountMinor: draft.amountMinor, voided: false }] }))
            close()
            toast.success(`${capitalise(TYPE_NOUN[r.type])} saved.`, `Dated ${fullDate(draft.occurredOn)}, for the ${fullDate(date)} occurrence.`)
            return { ok: true }
          }}
        />
      </DialogContent>
    )
  }

  const dialogs = (
    <Dialog open={open !== null} onOpenChange={(o) => !o && close()}>
      {open?.kind === "add" && (
        <DialogContent eyebrow="Recurring" title="Add recurring">
          <RuleForm
            data={data}
            today={today}
            onSave={(r) => simulate((d) => ({ ...d, rules: [...d.rules, { ...r, id: `r-${crypto.randomUUID()}`, archived: false }] }), "Recurring item added.", "It shows under Upcoming when it's due.")}
          />
        </DialogContent>
      )}
      {open?.kind === "edit" && (
        <DialogContent eyebrow="Recurring" title={`Edit ${entryTitle(asEntry(rule(open.ruleId), null), lookup)}`} description="Changes apply to future occurrences. Entries already saved don't change.">
          <RuleForm
            data={data}
            today={today}
            rule={rule(open.ruleId)}
            attention={blockedBy(rule(open.ruleId))}
            onSave={(r) => simulate((d) => ({ ...d, rules: d.rules.map((x) => (x.id === open.ruleId ? { ...x, ...r } : x)) }), "Recurring item saved.")}
          />
        </DialogContent>
      )}
      {confirmDialog()}
      {open?.kind === "skip" && (
        <DialogContent eyebrow="Recurring" title={`Skip ${fullDate(latestOccurrenceOnOrBefore(rule(open.ruleId), today)!)}?`}>
          <SkipForm
            onSkip={(reason) => {
              const date = latestOccurrenceOnOrBefore(rule(open.ruleId), today)!
              return simulate((d) => ({ ...d, skips: [...d.skips, { ruleId: open.ruleId, date, reason }] }), "Skipped.", "Nothing was saved for this date.")
            }}
          />
        </DialogContent>
      )}
      {open?.kind === "archive" && (
        <DialogContent eyebrow="Recurring" title={`Archive ${entryTitle(asEntry(rule(open.ruleId), null), lookup)}?`}>
          <Confirmation
            points={["It stops showing under Upcoming and leaves the cost totals.", "Entries it already saved stay in your history and totals.", "You can restore it later."]}
            action="Archive"
            onConfirm={() => simulate((d) => ({ ...d, rules: d.rules.map((x) => (x.id === open.ruleId ? { ...x, archived: true } : x)) }), "Recurring item archived.")}
          />
        </DialogContent>
      )}
      {open?.kind === "void" && (
        <DialogContent eyebrow="Recurring" title={`Void the entry for ${fullDate(open.date)}?`}>
          <Confirmation
            points={["It stops counting toward totals and balances, and stays in history as Voided.", "That date becomes due again, so you can confirm it with the right details."]}
            action="Void entry"
            destructive
            onConfirm={() =>
              simulate((d) => ({ ...d, posts: d.posts.map((p) => (p.ruleId === open.ruleId && p.date === open.date ? { ...p, voided: true } : p)) }), "Entry voided.", "That date is due again.")
            }
          />
        </DialogContent>
      )}
    </Dialog>
  )

  if (view !== "recurring") {
    return (
      <>
        {demoBar}
        <PageHeader
          eyebrow={view === "income" ? "Money in" : "Money activity"}
          title={view === "income" ? "Income" : "Transactions"}
          description="Only the Upcoming card is new; the rest of the page stays as it is."
        />
        <UpcomingCard
          items={items}
          lookup={lookup}
          today={today}
          type={view === "income" ? "income" : null}
          href={href({ view: "" })}
          onConfirm={(ruleId: string) => setOpen({ kind: "confirm", ruleId })}
        />
        {dialogs}
      </>
    )
  }

  const tile = (label: string, t: CostTotal, currency: string, what: string) => (
    <StatCard
      label={label}
      value={`${money(t.monthlyMinor, currency)} / month`}
      footer={`${money(t.yearlyMinor, currency)} a year · ${t.count} ${t.count === 1 ? what : `${what}s`} · estimated from default amounts`}
    />
  )

  return (
    <>
      {demoBar}
      <PageHeader
        eyebrow="Money activity"
        title="Recurring"
        description="Salary, rent, subscriptions and other repeating items. Nothing is saved until you confirm it."
        actions={
          <Button size="lg" onClick={() => setOpen({ kind: "add" })}>
            <Plus aria-hidden="true" />
            Add recurring
          </Button>
        }
      />

      <div className="grid gap-6">
        {costs.map((c) => (
          <section
            key={c.currency}
            aria-label={`Recurring cost in ${c.currency}`}
            className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 md:[&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1"
          >
            {tile(`Subscriptions${costs.length > 1 ? ` · ${c.currency}` : ""}`, c.subscriptions, c.currency, "subscription")}
            {tile(`Memberships${costs.length > 1 ? ` · ${c.currency}` : ""}`, c.memberships, c.currency, "membership")}
            {tile(`Total recurring cost${costs.length > 1 ? ` · ${c.currency}` : ""}`, c.total, c.currency, "expense")}
          </section>
        ))}
        {costs.length > 0 && (
          <p className="-mt-3 text-xs text-muted-foreground">
            Active recurring expenses only (not income, transfers, ended or archived rules). Each currency is totalled on its own; amounts are never converted.
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <RecurringPanel title="Due" count={due.length} description="Confirm to save the entry, or skip this date." empty="Nothing is due.">
            {due.map((i) => (
              <RecurringRow key={i.ruleId} item={i} lookup={lookup} today={today}>
                <Button variant="ghost" size="sm" onClick={() => setOpen({ kind: "skip", ruleId: i.ruleId })} aria-label={`Skip ${entryTitle(i.entry, lookup)}`}>
                  Skip
                </Button>
                <Button size="sm" onClick={() => setOpen({ kind: "confirm", ruleId: i.ruleId })} aria-label={`Confirm ${entryTitle(i.entry, lookup)}`}>
                  Confirm
                </Button>
              </RecurringRow>
            ))}
          </RecurringPanel>
          <RecurringPanel title="Needs attention" count={attention.length} description="These can't post until fixed." empty="All rules can post.">
            {attention.map((i) => (
              <RecurringRow key={i.ruleId} item={i} lookup={lookup} today={today}>
                <Button variant="secondary" size="sm" onClick={() => setOpen({ kind: "edit", ruleId: i.ruleId })} aria-label={`Fix ${entryTitle(i.entry, lookup)}`}>
                  Fix
                </Button>
              </RecurringRow>
            ))}
          </RecurringPanel>
          <RecurringPanel title={`Coming in ${UPCOMING_DAYS} days`} count={soon.length} empty={`Nothing in the next ${UPCOMING_DAYS} days.`}>
            {soon.map((i) => (
              <RecurringRow key={i.ruleId} item={i} lookup={lookup} today={today} />
            ))}
          </RecurringPanel>
          <RecurringPanel title="Ended" count={ended.length} description="Past their end date. Their entries stay." empty="No rules have ended.">
            {ended.map((i) => (
              <RecurringRow key={i.ruleId} item={i} lookup={lookup} today={today} />
            ))}
          </RecurringPanel>
        </div>

        {groupPanel("subscription", "Subscriptions", "No subscriptions. Use the Subscription category for streaming, apps and similar.")}
        {groupPanel("membership", "Memberships", "No memberships. Use the Membership category for clubs, gyms and similar.")}
        {groupPanel("other", "Other recurring", "No other recurring items.")}

        {archived.length > 0 && (
          <div>
            <Button variant="ghost" size="sm" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
            </Button>
            {showArchived && (
              <RecurringPanel title="Archived" count={archived.length} empty="" className="mt-2">
                {archived.map((r) => (
                  <RecurringRow key={r.id} item={{ ruleId: r.id, kind: "upcoming", date: null, schedule: scheduleText(r), entry: asEntry(r, null) }} lookup={lookup} today={today}>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Restore ${entryTitle(asEntry(r, null), lookup)}`}
                      onClick={() => simulate((d) => ({ ...d, rules: d.rules.map((x) => (x.id === r.id ? { ...x, archived: false } : x)) }), "Recurring item restored.", "Only its latest occurrence can be due.")}
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
      {dialogs}
    </>
  )
}
