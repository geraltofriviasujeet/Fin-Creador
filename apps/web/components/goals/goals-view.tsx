"use client"

import { useState, useTransition } from "react"
import { Plus, Sparkles } from "lucide-react"
import type { BudgetCategory, BudgetItem, GoalItem, GoalsView, WriteResult } from "@fin-creador/api"
import { type GoalType, formatPercentFromBasisPoints, minorToInputString } from "@fin-creador/domain"
import { EMI_ROUNDING_NOTE, GOAL_TYPE_OPTIONS, GOAL_UPFRONT_LABEL, ITEM_PAYMENTS, LOAN_PAYMENTS } from "@fin-creador/schemas"
import { setCategoryBudgetAction, setGoalArchivedAction, setGoalSavedAction } from "@/app/(app)/goals/actions"
import { AmountField } from "@/components/income/amount-field"
import { PageHeader } from "@/components/shell/app-shell"
import { fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { BudgetBadge, BudgetDonut, GOALS_HEADER, GOAL_ICON, GoalSummary, IconChip, Meter, SET_BUDGET_AGAIN, budgetLine, pct, savingText } from "./display"
import { GoalForm } from "./goal-form"

type Open =
  | { kind: "add" }
  | { kind: "edit" | "saved" | "archive"; item: GoalItem }
  | { kind: "budget"; item?: BudgetItem }
  | null

const NETWORK = "We couldn't reach the server. Your details are kept; try again."
async function run(save: () => Promise<WriteResult>): Promise<WriteResult> {
  try {
    return await save()
  } catch {
    return { status: "error", message: NETWORK }
  }
}

const TYPE_LABEL = Object.fromEntries(GOAL_TYPE_OPTIONS.map((t) => [t.value, t.label])) as Record<GoalType, string>
const PAYMENT_LABEL = Object.fromEntries([...LOAN_PAYMENTS, ...ITEM_PAYMENTS].map((p) => [p.value, p.label])) as Record<string, string>

/** The Goals page (Sprint 6): Planned expenses and Monthly budgets. */
export function GoalsPageView({ view }: { view: GoalsView }) {
  const [open, setOpen] = useState<Open>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [busy, startBusy] = useTransition()
  const close = () => setOpen(null)

  const restore = (item: GoalItem) =>
    startBusy(async () => {
      const result = await run(() => setGoalArchivedAction({ goalId: item.goal.id, archived: false }))
      if (result.status === "success") toast.success(result.message)
      else toast.error(result.message)
    })

  return (
    <>
      <PageHeader
        {...GOALS_HEADER}
        actions={
          <Button size="lg" onClick={() => setOpen({ kind: "add" })}>
            <Plus aria-hidden="true" />
            Plan an expense
          </Button>
        }
      />

      <section aria-labelledby="planned-title" className="grid gap-4">
        <h2 id="planned-title" className="font-heading text-xl font-bold">
          Planned expenses
        </h2>
        {view.active.length === 0 ? (
          <Card className="grid justify-items-start gap-3">
            <p className="font-semibold">Plan your first expense</p>
            <p className="text-sm text-muted-foreground">
              A trip, a car, a home or something else: enter your own figures and see how much to save each month.
            </p>
            <Button variant="secondary" onClick={() => setOpen({ kind: "add" })}>
              <Plus aria-hidden="true" />
              Plan an expense
            </Button>
          </Card>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {view.active.map((item) => (
              <GoalCard key={item.goal.id} item={item} onOpen={(kind) => setOpen({ kind, item })} />
            ))}
          </ul>
        )}
        {view.archived.length > 0 && (
          <div>
            <Button variant="link" aria-expanded={showArchived} onClick={() => setShowArchived((s) => !s)}>
              {showArchived ? "Hide" : "Show"} archived ({view.archived.length})
            </Button>
            {showArchived && (
              <Card className="mt-3">
                <ul>
                  {view.archived.map((item) => (
                    <GoalSummary key={item.goal.id} item={item}>
                      <Button variant="ghost" size="sm" disabled={busy} aria-label={`Restore ${item.goal.name}`} onClick={() => restore(item)}>
                        Restore
                      </Button>
                    </GoalSummary>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="budgets-title" className="mt-10 grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="budgets-title" className="font-heading text-xl font-bold">
              Monthly budgets
            </h2>
            <p className="text-sm text-muted-foreground">
              Spending this month ({fullDate(view.month.start)} to {fullDate(view.month.end)}) against each category&apos;s budget.
            </p>
          </div>
          {view.unbudgeted.length > 0 && (
            <Button variant="secondary" onClick={() => setOpen({ kind: "budget" })}>
              <Plus aria-hidden="true" />
              Set a budget
            </Button>
          )}
        </div>
        {view.budgets.length === 0 ? (
          <Card className="grid justify-items-start gap-2">
            <p className="font-semibold">No budgets this month</p>
            <p className="text-sm text-muted-foreground">Set a monthly amount for a category. You&apos;ll see a warning at 80% and when it&apos;s used up.</p>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
            <Card aria-labelledby="budget-total-title" className="grid content-start justify-items-center gap-4">
              <CardTitle id="budget-total-title" className="justify-self-start">
                This month
              </CardTitle>
              {view.total ? (
                <>
                  <BudgetDonut status={view.total} currency={view.currency} />
                  <p className="text-center text-sm text-muted-foreground tabular-nums">
                    {money(view.total.spentMinor, view.currency)} spent of {money(view.total.budgetMinor, view.currency)}
                  </p>
                  <BudgetBadge status={view.total} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Your budgets are in another currency. {SET_BUDGET_AGAIN} in {view.currency}.</p>
              )}
            </Card>
            <Card>
              <ul>
                {view.budgets.map((b) => (
                  <li key={b.category.id} className="grid gap-2 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        {b.category.name}
                        {b.category.archived && <Badge tone="neutral">Archived</Badge>}
                        <BudgetBadge status={b.status} />
                      </p>
                      <Button variant="ghost" size="sm" aria-label={`${b.status ? "Change" : SET_BUDGET_AGAIN}: ${b.category.name}`} onClick={() => setOpen({ kind: "budget", item: b })}>
                        {b.status ? "Change" : "Set again"}
                      </Button>
                    </div>
                    {b.status && <Meter valueBp={b.status.usedBps} label={`${b.category.name}: ${pct(b.status.usedBps)} of budget used`} tone={b.status.level === "ok" ? "default" : b.status.level} />}
                    <p className="text-xs text-muted-foreground tabular-nums">{budgetLine(b, view.currency)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </section>

      <Dialog open={open !== null} onOpenChange={(o) => !o && close()}>
        {open?.kind === "add" && (
          <DialogContent eyebrow="Goals" title="Plan an expense" description="Use your own figures. Nothing here is an estimate.">
            <GoalForm currency={view.currency} today={view.today} onDone={close} />
          </DialogContent>
        )}
        {open?.kind === "edit" && (
          <DialogContent eyebrow="Goals" title={`Edit ${open.item.goal.name}`}>
            <GoalForm currency={view.currency} today={view.today} item={open.item} onDone={close} />
          </DialogContent>
        )}
        {open?.kind === "saved" && (
          <DialogContent eyebrow="Goals" title={`Saved for ${open.item.goal.name}`} description="Enter the total saved so far. It isn't linked to your accounts.">
            <SavedForm item={open.item} onDone={close} />
          </DialogContent>
        )}
        {open?.kind === "archive" && (
          <DialogContent eyebrow="Goals" title={`Archive ${open.item.goal.name}?`} description="It moves to Archived. You can restore it later; nothing else changes.">
            <ArchiveForm item={open.item} onDone={close} />
          </DialogContent>
        )}
        {open?.kind === "budget" && (
          <DialogContent eyebrow="Monthly budgets" title={open.item ? `Budget for ${open.item.category.name}` : "Set a budget"} description="The amount applies from the month you choose onward. Past months keep their budget.">
            <BudgetForm view={view} item={open.item} onDone={close} />
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

function answersLine(item: GoalItem): string | null {
  const a = item.answers
  if (!a) return null
  switch (a.type) {
    case "trip":
      return `${a.details.scope === "international" ? "International" : "Domestic"} · ${a.details.place} · ${a.details.people} ${a.details.people === 1 ? "person" : "people"} · ${a.details.days} ${a.details.days === 1 ? "day" : "days"}`
    case "car":
      return `${a.details.condition === "new" ? "New" : "Used"} · ${a.details.model} · ${PAYMENT_LABEL[a.details.payment]}`
    case "house":
      return `${a.details.purpose === "buy" ? "Buy" : "Renovate"} · ${a.details.city} · ${PAYMENT_LABEL[a.details.payment]}`
    case "furniture":
    case "electronics":
    case "mobile":
      return `${a.details.item} · ${PAYMENT_LABEL[a.details.payment]}`
    case "other":
      return a.details.description
  }
}

function GoalCard({ item, onOpen }: { item: GoalItem; onOpen: (kind: "edit" | "saved" | "archive") => void }) {
  const { goal, plan, figures } = item
  const type = goal.type as GoalType
  const loan = figures?.loan
  return (
    <li>
      <Card aria-labelledby={`goal-${goal.id}`} className="grid h-full content-start gap-4">
        <div className="flex gap-3">
          <IconChip>{GOAL_ICON[type] ?? GOAL_ICON.other}</IconChip>
          <div className="min-w-0 flex-1">
            <h3 id={`goal-${goal.id}`} className="truncate font-heading text-lg font-bold">
              {goal.name}
            </h3>
            <p className="truncate text-xs text-muted-foreground">
              {TYPE_LABEL[type] ?? "Goal"}
              {answersLine(item) ? ` · ${answersLine(item)}` : ""}
            </p>
          </div>
        </div>

        {!item.answers && <FormMessage tone="info">We couldn&apos;t read this plan&apos;s details. Edit it to enter them again.</FormMessage>}

        <div className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-muted-foreground">{type === "other" ? "Amount to save" : GOAL_UPFRONT_LABEL}</p>
            <p className="font-heading text-xl font-bold tabular-nums">{money(goal.targetMinor, goal.currency)}</p>
          </div>
          {plan.progressBps !== null && <Meter valueBp={plan.progressBps} label={`${goal.name}: ${pct(plan.progressBps)} saved`} />}
          <p className="text-xs text-muted-foreground tabular-nums">
            {money(goal.savedMinor, goal.currency)} saved{plan.progressBps !== null ? ` · ${pct(plan.progressBps)}` : ""}
          </p>
        </div>

        <p className="rounded-xl bg-canvas px-3 py-2.5 text-sm font-semibold">{savingText(item)}</p>

        {loan && (
          <div className="grid gap-1 text-sm">
            <p>
              {loan.annualRateBps === 0 ? "No-cost EMI" : "EMI"} <span className="font-semibold tabular-nums">{money(loan.emiMinor, goal.currency)}</span> a month for {loan.months} months on{" "}
              {money(loan.principalMinor, goal.currency)}
              {loan.annualRateBps > 0 && ` at ${formatPercentFromBasisPoints(loan.annualRateBps, { maximumFractionDigits: 2 })} a year`}
            </p>
            <p className="text-muted-foreground tabular-nums">
              Total interest {money(loan.totalInterestMinor, goal.currency)} · total payable {money(loan.totalPayableMinor, goal.currency)}
            </p>
            <p className="text-xs text-muted-foreground">{EMI_ROUNDING_NOTE}</p>
          </div>
        )}

        <div aria-disabled="true" className="flex items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted-foreground">
          <Sparkles aria-hidden="true" className="size-4 shrink-0" />
          <span className="flex-1">AI insights</span>
          <Badge tone="neutral">Coming soon</Badge>
        </div>

        <div className="flex flex-wrap gap-1">
          <Button variant="secondary" size="sm" aria-label={`Update saved amount for ${goal.name}`} onClick={() => onOpen("saved")}>
            Update saved
          </Button>
          <Button variant="ghost" size="sm" aria-label={`Edit ${goal.name}`} onClick={() => onOpen("edit")}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" aria-label={`Archive ${goal.name}`} onClick={() => onOpen("archive")}>
            Archive
          </Button>
        </div>
      </Card>
    </li>
  )
}

function SavedForm({ item, onDone }: { item: GoalItem; onDone: () => void }) {
  const [saved, setSaved] = useState(item.goal.savedMinor ? minorToInputString(item.goal.savedMinor, item.goal.currency) : "")
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    const result = await run(() => setGoalSavedAction({ goalId: item.goal.id, saved }))
    setPending(false)
    if (result.status === "success") {
      toast.success(result.message)
      onDone()
    } else setError(result.fieldErrors?.saved ?? result.message)
  }
  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <AmountField name="saved" label="Saved so far" currency={item.goal.currency} defaultValue={saved} error={error} onChange={setSaved} autoFocus />
      <div className="flex flex-wrap justify-end gap-2">
        <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Cancel</DialogClose>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  )
}

function ArchiveForm({ item, onDone }: { item: GoalItem; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  async function archive() {
    setPending(true)
    const result = await run(() => setGoalArchivedAction({ goalId: item.goal.id, archived: true }))
    setPending(false)
    if (result.status === "success") {
      toast.success(result.message)
      onDone()
    } else setError(result.message)
  }
  return (
    <div className="grid gap-5">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className="flex flex-wrap justify-end gap-2">
        <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Cancel</DialogClose>
        <Button type="button" size="lg" disabled={pending} aria-busy={pending} onClick={archive}>
          {pending ? "Archiving…" : "Archive"}
        </Button>
      </div>
    </div>
  )
}

function BudgetForm({ view, item, onDone }: { view: GoalsView; item?: BudgetItem; onDone: () => void }) {
  const thisMonth = view.today.slice(0, 7)
  const options: BudgetCategory[] = item ? [item.category] : view.unbudgeted
  const [categoryId, setCategoryId] = useState(item?.category.id ?? "")
  const [month, setMonth] = useState(thisMonth)
  const [amount, setAmount] = useState(item?.status ? minorToInputString(item.budget.amountMinor, view.currency) : "")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setFormError(null)
    const result = await run(() => setCategoryBudgetAction({ categoryId, month, amount }))
    setPending(false)
    if (result.status === "success") {
      toast.success(result.message)
      onDone()
      return
    }
    setFormError(result.message)
    setErrors(result.fieldErrors ?? {})
  }
  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      {item && !item.status && (
        <FormMessage tone="info">
          This budget is in {item.budget.currency}. Enter it again in {view.currency}.
        </FormMessage>
      )}
      <SelectField name="categoryId" label="Category" value={categoryId} disabled={Boolean(item)} error={errors.categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        {!item && <option value="">Choose a category</option>}
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <div className="grid items-start gap-5 md:grid-cols-2">
        <AmountField name="amount" label="Monthly budget" currency={view.currency} defaultValue={amount} error={errors.amount} onChange={setAmount} hint={item ? "0 or blank removes it from that month on." : undefined} autoFocus />
        <TextField name="month" label="From" type="month" min={thisMonth} value={month} error={errors.month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Cancel</DialogClose>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Save budget"}
        </Button>
      </div>
    </form>
  )
}

export function GoalsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading goals">
      <PageHeader {...GOALS_HEADER} />
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="grid gap-3">
            <span className="h-5 w-40 rounded bg-canvas" />
            <span className="h-8 w-32 rounded bg-canvas" />
            <span className="h-1.5 w-full rounded bg-canvas" />
            <span className="h-10 w-full rounded-xl bg-canvas" />
          </Card>
        ))}
      </div>
      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card className="h-56" />
        <Card className="h-56" />
      </div>
    </div>
  )
}
