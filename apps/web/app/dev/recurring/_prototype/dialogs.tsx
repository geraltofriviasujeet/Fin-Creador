"use client"

// Dialogs for the Sprint 4 recurring prototype (demo data only).
import { useState } from "react"
import type { EntryType } from "@fin-creador/api"
import {
  AMOUNT_ERROR_MESSAGES,
  FREQUENCIES,
  type Frequency,
  type IsoDate,
  anchorDayMayMove,
  minorToInputString,
  parseAmount,
  type recurringStatus,
  scheduleText,
} from "@fin-creador/domain"
import { PAYMENT_MODES, type PaymentModeValue } from "@fin-creador/schemas"
import { cn } from "cn"
import { AmountField } from "@/components/income/amount-field"
import { fullDate } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DialogClose } from "@/components/ui/dialog"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import type { DemoData, DemoRule } from "./demo-data"

const TYPES: { value: EntryType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
]

export function StatusBadge({ status, today }: { status: ReturnType<typeof recurringStatus>; today: IsoDate }) {
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

export type RuleDraft = Omit<DemoRule, "id" | "archived">

export function RuleForm({
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

export function SkipForm({ onSkip }: { onSkip: (reason: string | null) => Promise<{ ok: true }> }) {
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

export function Confirmation({ points, action, destructive, onConfirm }: { points: string[]; action: string; destructive?: boolean; onConfirm: () => Promise<{ ok: true }> }) {
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
