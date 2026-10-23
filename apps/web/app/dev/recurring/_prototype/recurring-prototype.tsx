"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { FlaskConical, Plus } from "lucide-react"
import type { EntryType, LedgerItem, Lookup } from "@fin-creador/api"
import {
  AMOUNT_ERROR_MESSAGES,
  FREQUENCIES,
  type Frequency,
  type IsoDate,
  anchorDayMayMove,
  latestOccurrenceOnOrBefore,
  minorToInputString,
  parseAmount,
  recurringStatus,
  scheduleText,
} from "@fin-creador/domain"
import { PAYMENT_MODES, type PaymentModeValue } from "@fin-creador/schemas"
import { cn } from "cn"
import { AmountField } from "@/components/income/amount-field"
import { Upcoming, type UpcomingItem } from "@/components/recurring/upcoming"
import { PageHeader } from "@/components/shell/app-shell"
import { TYPE_NOUN, accountChipText, entryKindLabel, entryTitle, fullDate, signedAmount } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { type DemoData, type DemoRule, createDemoData } from "./demo-data"

type Placement = "transactions" | "income"
type Open =
  | { kind: "add" }
  | { kind: "edit" | "confirm" | "skip" | "archive"; ruleId: string }
  | { kind: "void"; ruleId: string; date: IsoDate }
  | null

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const TYPES: { value: EntryType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
]

/** Reads the URL; remounts the prototype when the demo state changes (fresh demo data). */
export function RecurringPrototype({ today }: { today: IsoDate }) {
  const params = useSearchParams()
  const empty = params.get("demo") === "empty"
  const placement: Placement = params.get("on") === "income" ? "income" : "transactions"
  return <Prototype key={String(empty)} today={today} empty={empty} placement={placement} />
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

function Prototype({ today, empty, placement }: { today: IsoDate; empty: boolean; placement: Placement }) {
  const pathname = usePathname()
  const [data, setData] = useState<DemoData>(() => createDemoData(today, { empty }))
  const [open, setOpen] = useState<Open>(null)
  const [showArchived, setShowArchived] = useState(false)
  const close = () => setOpen(null)

  const lookup: Lookup = useMemo(
    () => ({ accounts: new Map(data.accounts.map((a) => [a.id, a])), categories: new Map(data.categories.map((c) => [c.id, c])) }),
    [data.accounts, data.categories]
  )

  // Why a rule can't post: an archived account or category (decision L).
  const blockedBy = (r: DemoRule): string | null => {
    const archivedAccount = [r.accountId, r.counterAccountId].map((id) => (id ? lookup.accounts.get(id) : undefined)).find((a) => a?.archived)
    if (archivedAccount) return `${archivedAccount.label} is archived. Choose another account to keep this rule posting.`
    const c = r.categoryId ? lookup.categories.get(r.categoryId) : undefined
    if (c?.archived) return `${c.name} is archived. Choose another ${r.type === "income" ? "source" : "category"} to keep this rule posting.`
    return null
  }
  // Occurrences already handled: posted (not voided) or skipped.
  const handled = (r: DemoRule) =>
    new Set([...data.posts.filter((p) => p.ruleId === r.id && !p.voided).map((p) => p.date), ...data.skips.filter((s) => s.ruleId === r.id).map((s) => s.date)])
  const statusOf = (r: DemoRule) => recurringStatus({ ...r, blocked: blockedBy(r) !== null }, today, handled(r))

  const items: UpcomingItem[] = data.rules.flatMap((r) => {
    const s = statusOf(r)
    if (s.kind !== "due" && s.kind !== "needs_attention" && s.kind !== "upcoming") return []
    return [{ ruleId: r.id, kind: s.kind, date: s.date, schedule: scheduleText(r), entry: asEntry(r, s.date), attention: blockedBy(r) ?? undefined }]
  })
  const rule = (id: string) => data.rules.find((r) => r.id === id)!

  async function simulate(apply: (d: DemoData) => DemoData, message: string, detail?: string) {
    await wait(600)
    setData(apply)
    close()
    toast.success(message, detail)
    return { ok: true as const }
  }

  const active = data.rules.filter((r) => !r.archived)
  const archived = data.rules.filter((r) => r.archived)
  const href = (more: Record<string, string>) => {
    const p = new URLSearchParams({ ...(empty ? { demo: "empty" } : {}), ...(placement === "income" ? { on: "income" } : {}), ...more })
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k)
    const s = p.toString()
    return `${pathname}${s ? `?${s}` : ""}`
  }

  return (
    <>
      <div role="note" className="mb-6 grid gap-3 rounded-xl border border-dashed border-line-strong bg-chip-blue px-4 py-3 text-sm">
        <p className="flex items-start gap-3">
          <FlaskConical aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>
            <strong className="font-semibold">Demo data.</strong> Development-only prototype of Sprint 4 recurring items. Every account,
            rule and entry here is made up and kept in memory; nothing is saved, and reloading starts again.
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-8 text-xs font-semibold">
          <span className="text-muted-foreground">Upcoming as shown on:</span>
          {(["transactions", "income"] as const).map((p) => (
            <Link key={p} href={href({ on: p === "income" ? "income" : "" })} aria-current={p === placement ? "page" : undefined} className={cn("rounded-md px-2 py-1", p === placement ? "bg-ink text-white" : "underline underline-offset-4")}>
              {p === "income" ? "Income page (income only)" : "Transactions page (all types)"}
            </Link>
          ))}
          <Link href={href({ demo: empty ? "" : "empty" })} className="underline underline-offset-4">
            {empty ? "With rules" : "No rules"}
          </Link>
          <button type="button" className="underline underline-offset-4" onClick={() => { setData(createDemoData(today, { empty })); toast.info("Demo data reset.") }}>
            Reset demo data
          </button>
        </div>
      </div>

      <PageHeader
        eyebrow="Money activity"
        title={placement === "income" ? "Income" : "Transactions"}
        description="Recurring items: confirm each one when it happens."
        actions={
          <Button size="lg" onClick={() => setOpen({ kind: "add" })}>
            <Plus aria-hidden="true" />
            Add recurring
          </Button>
        }
      />

      <div className="grid gap-6">
        <Upcoming
          items={items}
          lookup={lookup}
          today={today}
          type={placement === "income" ? "income" : null}
          onConfirm={(ruleId) => setOpen({ kind: "confirm", ruleId })}
          onSkip={(ruleId) => setOpen({ kind: "skip", ruleId })}
          onFix={(ruleId) => setOpen({ kind: "edit", ruleId })}
          onManage={() => document.getElementById("recurring-rules")?.scrollIntoView({ behavior: "smooth" })}
        />

        <Card id="recurring-rules" className="px-0 md:px-0">
          <div className="px-5 md:px-6">
            <CardTitle>Recurring</CardTitle>
            <CardDescription className="mt-1">Your rules. Editing one changes future occurrences only; entries already saved never change.</CardDescription>
          </div>
          {active.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted-foreground md:px-6">No recurring items yet. Add salary, rent, a subscription or a monthly transfer.</p>
          ) : (
            <ul className="mt-4">
              {active.map((r) => {
                const s = statusOf(r)
                const lastPost = data.posts.filter((p) => p.ruleId === r.id && !p.voided).sort((a, b) => b.date.localeCompare(a.date))[0]
                const entry = asEntry(r, null)
                return (
                  <li key={r.id} className="grid gap-2 border-t border-line px-5 py-3 md:flex md:items-center md:gap-4 md:px-6">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                        <span className="truncate">{entryTitle(entry, lookup)}</span>
                        <StatusBadge status={s} today={today} />
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {signedAmount(entry)} · {scheduleText(r)} · {entryKindLabel(entry, lookup)} · {accountChipText(entry, lookup)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        From {fullDate(r.startDate)}
                        {r.endDate ? ` to ${fullDate(r.endDate)}` : ""}
                        {lastPost && (
                          <>
                            {" "}· Last saved {fullDate(lastPost.date)}{" "}
                            <button type="button" className="font-semibold text-ink underline underline-offset-4" onClick={() => setOpen({ kind: "void", ruleId: r.id, date: lastPost.date })}>
                              Void it
                            </button>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setOpen({ kind: "edit", ruleId: r.id })} aria-label={`Edit ${entryTitle(entry, lookup)}`}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setOpen({ kind: "archive", ruleId: r.id })} aria-label={`Archive ${entryTitle(entry, lookup)}`}>
                        Archive
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {archived.length > 0 && (
            <div className="border-t border-line px-5 pt-3 md:px-6">
              <Button variant="ghost" size="sm" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
                {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
              </Button>
              {showArchived && (
                <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
                  {archived.map((r) => (
                    <li key={r.id}>
                      {entryTitle(asEntry(r, null), lookup)} · {scheduleText(r)} · archived (its saved entries stay)
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      </div>

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
        {open?.kind === "confirm" && (
          <DialogContent eyebrow="Upcoming" title={`Confirm ${TYPE_NOUN[rule(open.ruleId).type]}`}>
            <ConfirmForm
              rule={rule(open.ruleId)}
              date={latestOccurrenceOnOrBefore(rule(open.ruleId), today)!}
              lookup={lookup}
              onConfirm={(amountMinor) => {
                const r = rule(open.ruleId)
                const date = latestOccurrenceOnOrBefore(r, today)!
                return simulate((d) => ({ ...d, posts: [...d.posts, { ruleId: r.id, date, amountMinor, voided: false }] }), `${TYPE_NOUN[r.type].replace(/^./, (c) => c.toUpperCase())} saved.`, `Dated ${fullDate(date)}.`)
              }}
            />
          </DialogContent>
        )}
        {open?.kind === "skip" && (
          <DialogContent eyebrow="Upcoming" title={`Skip ${fullDate(latestOccurrenceOnOrBefore(rule(open.ruleId), today)!)}?`}>
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
              points={["It stops showing under Upcoming.", "Entries it already saved stay in your history and totals.", "To start again later, add a new recurring item."]}
              action="Archive"
              onConfirm={() => simulate((d) => ({ ...d, rules: d.rules.map((x) => (x.id === open.ruleId ? { ...x, archived: true } : x)) }), "Recurring item archived.")}
            />
          </DialogContent>
        )}
        {open?.kind === "void" && (
          <DialogContent eyebrow="Recurring" title={`Void the entry of ${fullDate(open.date)}?`}>
            <Confirmation
              points={["It stops counting toward totals and balances, and stays in history as Voided.", "This date becomes due again under Upcoming, so you can confirm it with the right details."]}
              action="Void entry"
              destructive
              onConfirm={() =>
                simulate(
                  (d) => ({ ...d, posts: d.posts.map((p) => (p.ruleId === open.ruleId && p.date === open.date ? { ...p, voided: true } : p)) }),
                  "Entry voided.",
                  "That date is due again."
                )
              }
            />
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

function StatusBadge({ status, today }: { status: ReturnType<typeof recurringStatus>; today: IsoDate }) {
  switch (status.kind) {
    case "due":
      return <Badge tone="info">{status.date < today ? `Missed ${fullDate(status.date)}` : "Due today"}</Badge>
    case "needs_attention":
      return <Badge tone="negative">Needs attention</Badge>
    case "upcoming":
      return <Badge tone="neutral">Next {fullDate(status.date)}</Badge>
    case "ended":
      return <Badge tone="neutral">Ended</Badge>
    default:
      return null
  }
}

type RuleDraft = Omit<DemoRule, "id" | "archived">

function RuleForm({
  data,
  today,
  rule,
  attention,
  onSave,
}: {
  data: DemoData
  today: IsoDate
  rule?: DemoRule
  attention?: string | null
  onSave: (r: RuleDraft) => Promise<{ ok: true }>
}) {
  const [type, setType] = useState<EntryType>(rule?.type ?? "expense")
  const [amount, setAmount] = useState(rule ? minorToInputString(rule.amountMinor, rule.currency) : "")
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? "")
  const [accountId, setAccountId] = useState(rule?.accountId ?? "")
  const [counterAccountId, setCounterAccountId] = useState(rule?.counterAccountId ?? "")
  const [paymentMode, setPaymentMode] = useState<string>(rule?.paymentMode ?? "")
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? "monthly")
  const [startDate, setStartDate] = useState(rule?.startDate ?? today)
  const [endDate, setEndDate] = useState(rule?.endDate ?? "")
  const [note, setNote] = useState(rule?.note ?? "")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  // New rules can't use archived accounts or categories; a rule that needs attention must move off them.
  const accounts = data.accounts.filter((a) => !a.archived)
  const categories = data.categories.filter((c) => c.kind === type && !c.archived)
  const account = data.accounts.find((a) => a.id === accountId)
  const editing = Boolean(rule)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    const next: Record<string, string> = {}
    const parsed = parseAmount(amount, account?.currency ?? data.currency)
    if (!parsed.ok) next.amount = AMOUNT_ERROR_MESSAGES[parsed.error]
    if (type !== "transfer" && !categories.some((c) => c.id === categoryId)) next.categoryId = type === "income" ? "Choose a source" : "Choose a category"
    if (!accounts.some((a) => a.id === accountId)) next.accountId = "Choose an account"
    if (type === "transfer" && (!accounts.some((a) => a.id === counterAccountId) || counterAccountId === accountId)) next.counterAccountId = "Choose a different account"
    if (endDate && endDate < startDate) next.endDate = "The end date can't be before the start"
    setErrors(next)
    if (Object.keys(next).length > 0 || !parsed.ok) return
    setPending(true)
    await onSave({
      type,
      amountMinor: parsed.minor,
      currency: account?.currency ?? data.currency,
      accountId,
      counterAccountId: type === "transfer" ? counterAccountId : null,
      categoryId: type === "transfer" ? null : categoryId,
      paymentMode: type === "expense" && account?.kind === "bank" && paymentMode ? (paymentMode as PaymentModeValue) : null,
      note: note.trim() || null,
      frequency,
      startDate,
      endDate: endDate || null,
    })
    setPending(false)
  }

  const option = (a: { id: string; label: string }) => (
    <option key={a.id} value={a.id}>
      {a.label}
    </option>
  )

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      {attention && <FormMessage tone="error">{attention}</FormMessage>}
      <div role="radiogroup" aria-label="Type" className="grid grid-cols-3 gap-1 rounded-xl bg-canvas p-1">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={t.value === type}
            disabled={editing && t.value !== type}
            onClick={() => {
              setType(t.value)
              setCategoryId("")
            }}
            className={cn("flex h-11 items-center justify-center rounded-lg text-sm font-semibold disabled:cursor-not-allowed", t.value === type ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <AmountField name="amount" label="Amount" currency={account?.currency ?? data.currency} defaultValue={amount} error={errors.amount} onChange={setAmount} hint="You can change it each time you confirm." />
      <div className="grid items-start gap-5 md:grid-cols-2">
        {type === "transfer" ? (
          <SelectField name="accountId" label="From" value={accountId} error={errors.accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose an account</option>
            {accounts.map(option)}
          </SelectField>
        ) : (
          <SelectField name="categoryId" label={type === "income" ? "Source" : "Category"} value={categoryId} error={errors.categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{type === "income" ? "Choose a source" : "Choose a category"}</option>
            {categories.map((c) => option({ id: c.id, label: c.name }))}
          </SelectField>
        )}
        {type === "transfer" ? (
          <SelectField name="counterAccountId" label="To" value={counterAccountId} error={errors.counterAccountId} onChange={(e) => setCounterAccountId(e.target.value)}>
            <option value="">Choose an account</option>
            {accounts.filter((a) => a.id !== accountId).map(option)}
          </SelectField>
        ) : (
          <SelectField name="accountId" label={type === "income" ? "Received into" : "Paid from"} value={accountId} error={errors.accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose an account</option>
            {accounts.map(option)}
          </SelectField>
        )}
      </div>
      {type === "expense" && account?.kind === "bank" && (
        <SelectField name="paymentMode" label="Payment mode (optional)" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
          <option value="">Not specified</option>
          {PAYMENT_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </SelectField>
      )}
      <div className="grid items-start gap-5 md:grid-cols-3">
        <SelectField
          name="frequency"
          label="Repeats"
          value={frequency}
          disabled={editing}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
          hint={editing ? "To change it, end this rule and add a new one." : undefined}
        >
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </SelectField>
        <TextField name="startDate" type="date" label="Starts on" value={startDate} disabled={editing} onChange={(e) => e.target.value && setStartDate(e.target.value)} />
        <TextField name="endDate" type="date" label="Ends on (optional)" value={endDate} min={startDate} error={errors.endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {scheduleText({ frequency, startDate })}
        {anchorDayMayMove({ frequency, startDate }) ? ", or the month's last day when it is shorter" : ""}. Nothing is saved by itself: each one shows under Upcoming for you to confirm.
      </p>
      <TextField name="note" label="Note" placeholder="e.g. Flat rent" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-2 flex justify-end gap-3">
        <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Cancel</DialogClose>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Add recurring"}
        </Button>
      </div>
    </form>
  )
}

function ConfirmForm({ rule, date, lookup, onConfirm }: { rule: DemoRule; date: IsoDate; lookup: Lookup; onConfirm: (amountMinor: number) => Promise<{ ok: true }> }) {
  const [amount, setAmount] = useState(minorToInputString(rule.amountMinor, rule.currency))
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)
  const entry = asEntry(rule, date)
  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        if (pending) return
        const parsed = parseAmount(amount, rule.currency)
        if (!parsed.ok) return setError(AMOUNT_ERROR_MESSAGES[parsed.error])
        setPending(true)
        await onConfirm(parsed.minor)
        setPending(false)
      }}
    >
      <div className="grid gap-1 rounded-xl bg-canvas px-4 py-3 text-sm">
        <span className="font-semibold">{entryTitle(entry, lookup)}</span>
        <span className="text-xs text-muted-foreground">
          {entryKindLabel(entry, lookup)} · {accountChipText(entry, lookup)} · {fullDate(date)} · {scheduleText(rule)}
        </span>
      </div>
      <AmountField name="amount" label="Amount" currency={rule.currency} defaultValue={amount} error={error} onChange={setAmount} autoFocus hint="A different amount this time doesn't change the rule." />
      <p className="text-sm text-muted-foreground">
        Saved as {rule.type === "income" ? "income" : rule.type === "expense" ? "an expense" : "a transfer"} dated {fullDate(date)}. It can be edited or voided later like any entry.
      </p>
      <div className="flex justify-end gap-3">
        <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Cancel</DialogClose>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Confirm and save"}
        </Button>
      </div>
    </form>
  )
}

function SkipForm({ onSkip }: { onSkip: (reason: string | null) => Promise<{ ok: true }> }) {
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)
  return (
    <form
      className="grid gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        if (pending) return
        setPending(true)
        await onSkip(reason.trim() || null)
        setPending(false)
      }}
    >
      <ul className="grid list-disc gap-1.5 pl-5 text-sm text-muted-foreground">
        <li>Nothing is saved for this date.</li>
        <li>Use it when you already added the entry by hand, or it didn&apos;t happen this time.</li>
        <li>The next date shows under Upcoming as usual.</li>
      </ul>
      <TextField name="reason" label="Reason (optional)" placeholder="e.g. Added by hand" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex justify-end gap-3">
        <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Keep it due</DialogClose>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Skipping…" : "Skip"}
        </Button>
      </div>
    </form>
  )
}

function Confirmation({ points, action, destructive, onConfirm }: { points: string[]; action: string; destructive?: boolean; onConfirm: () => Promise<{ ok: true }> }) {
  const [pending, setPending] = useState(false)
  return (
    <div className="grid gap-5">
      <ul className="grid list-disc gap-1.5 pl-5 text-sm text-muted-foreground">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <div className="flex justify-end gap-3">
        <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Cancel</DialogClose>
        <Button
          size="lg"
          variant={destructive ? "destructive" : "primary"}
          disabled={pending}
          aria-busy={pending}
          onClick={async () => {
            setPending(true)
            await onConfirm()
            setPending(false)
          }}
        >
          {pending ? "Saving…" : action}
        </Button>
      </div>
    </div>
  )
}
