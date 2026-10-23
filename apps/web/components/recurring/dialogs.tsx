"use client"

import { useState } from "react"
import { type EntryType, type LedgerAccount, type LedgerCategory, type RecurringItem, type WriteResult, newRequestKey } from "@fin-creador/api"
import { FREQUENCIES, type Frequency, type IsoDate, anchorDayMayMove, minorToInputString, scheduleText } from "@fin-creador/domain"
import { PAYMENT_MODES } from "@fin-creador/schemas"
import { cn } from "cn"
import {
  confirmOccurrenceAction,
  saveRecurringRuleAction,
  setRecurringRuleArchivedAction,
  skipOccurrenceAction,
} from "@/app/(app)/recurring/actions"
import { AmountField } from "@/components/income/amount-field"
import { TYPE_NOUN, fullDate } from "@/components/transactions/display"
import { TransactionForm } from "@/components/transactions/transaction-form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"

// Dialogs for recurring items on real data, shared by the Recurring page and the Upcoming
// cards on Income and Transactions. Saves go through the server actions (shared writers in
// packages/api), which refresh the three pages.

export type RecurringDialog =
  | { kind: "add" }
  | { kind: "edit" | "confirm" | "skip" | "archive"; item: RecurringItem }
  | null

type Data = { accounts: LedgerAccount[]; categories: LedgerCategory[]; today: IsoDate; currency: string }

const NETWORK = "We couldn't reach the server. Your details are kept; try again."
async function run(save: () => Promise<WriteResult>): Promise<WriteResult> {
  try {
    return await save()
  } catch {
    return { status: "error", message: NETWORK }
  }
}

export function RecurringDialogs({ open, onClose, titleOf, ...data }: Data & { open: RecurringDialog; onClose: () => void; titleOf: (item: RecurringItem) => string }) {
  return (
    <Dialog open={open !== null} onOpenChange={(o) => !o && onClose()}>
      {open?.kind === "add" && (
        <DialogContent eyebrow="Recurring" title="Add recurring">
          <RuleForm {...data} onDone={onClose} />
        </DialogContent>
      )}
      {open?.kind === "edit" && (
        <DialogContent eyebrow="Recurring" title={`Edit ${titleOf(open.item)}`} description="Changes apply to future occurrences. Entries already saved don't change.">
          <RuleForm {...data} item={open.item} onDone={onClose} />
        </DialogContent>
      )}
      {open?.kind === "confirm" && open.item.date && (
        <DialogContent
          eyebrow={`Recurring · ${fullDate(open.item.date)}`}
          title={`Add ${TYPE_NOUN[open.item.rule.type]}`}
          description={`${open.item.schedule}. Check the details; the category comes from the recurring item.`}
        >
          <TransactionForm
            mode={{ kind: "add", type: open.item.rule.type, locked: true, prefill: open.item.entry }}
            accounts={data.accounts}
            categories={data.categories}
            today={data.today}
            onSave={async (draft, requestKey) => {
              const currency = data.accounts.find((a) => a.id === draft.accountId)?.currency ?? data.currency
              const result = await run(() =>
                confirmOccurrenceAction({
                  ruleId: open.item.rule.id,
                  occurrenceDate: open.item.date,
                  type: open.item.rule.type,
                  amount: minorToInputString(draft.amountMinor, currency),
                  occurredOn: draft.occurredOn,
                  accountId: draft.accountId,
                  counterAccountId: draft.counterAccountId ?? "",
                  paymentMode: draft.paymentMode ?? "",
                  note: draft.note ?? "",
                  idempotencyKey: requestKey,
                })
              )
              if (result.status === "success") {
                onClose()
                toast.success(result.message, `For the ${fullDate(open.item.date!)} occurrence.`)
                return { ok: true }
              }
              return { ok: false, message: result.message, fieldErrors: result.fieldErrors }
            }}
          />
        </DialogContent>
      )}
      {open?.kind === "skip" && open.item.date && (
        <DialogContent eyebrow="Recurring" title={`Skip ${fullDate(open.item.date)}?`}>
          <SkipForm item={open.item} onDone={onClose} />
        </DialogContent>
      )}
      {open?.kind === "archive" && (
        <DialogContent eyebrow="Recurring" title={`Archive ${titleOf(open.item)}?`}>
          <ArchiveForm item={open.item} onDone={onClose} />
        </DialogContent>
      )}
    </Dialog>
  )
}

const TYPES: { value: EntryType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
]

function RuleForm({ accounts, categories, today, currency, item, onDone }: Data & { item?: RecurringItem; onDone: () => void }) {
  const rule = item?.rule
  // One key per opened form; a retry after a failure reuses it, so the rule is added once.
  const [requestKey] = useState(newRequestKey)
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
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // New choices can't be archived; an edit may keep the archived one it has (it then still needs attention).
  const usableAccounts = accounts.filter((a) => !a.archived || a.id === rule?.accountId || a.id === rule?.counterAccountId)
  const kindCategories = categories.filter((c) => c.kind === type && (!c.archived || c.id === rule?.categoryId))
  const account = accounts.find((a) => a.id === accountId)
  const editing = Boolean(rule)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setFormError(null)
    const result = await run(() =>
      saveRecurringRuleAction({
        ruleId: rule?.id ?? "",
        type,
        amount,
        categoryId: type === "transfer" ? "" : categoryId,
        accountId,
        counterAccountId: type === "transfer" ? counterAccountId : "",
        paymentMode: type === "expense" ? paymentMode : "",
        frequency,
        startDate,
        endDate,
        note,
        idempotencyKey: editing ? "" : requestKey,
      })
    )
    setPending(false)
    if (result.status === "success") {
      toast.success(result.message, editing ? undefined : "It shows under Upcoming when it's due.")
      onDone()
      return
    }
    setFormError(result.message)
    setErrors(result.fieldErrors ?? {})
  }

  const option = (a: { id: string; label: string; archived: boolean }) => (
    <option key={a.id} value={a.id}>
      {a.label}
      {a.archived ? " (archived)" : ""}
    </option>
  )

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      {item?.attention && <FormMessage tone="error">{item.attention}</FormMessage>}
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
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
            className={cn(
              "flex h-11 items-center justify-center rounded-lg text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed",
              t.value === type ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-ink"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <AmountField name="amount" label="Amount" currency={account?.currency ?? currency} defaultValue={amount} error={errors.amount} onChange={setAmount} hint="You can change it each time you confirm." autoFocus={!editing} />
      <div className="grid items-start gap-5 md:grid-cols-2">
        {type === "transfer" ? (
          <SelectField name="accountId" label="From" value={accountId} error={errors.accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose an account</option>
            {usableAccounts.map(option)}
          </SelectField>
        ) : (
          <SelectField name="categoryId" label={type === "income" ? "Source" : "Category"} value={categoryId} error={errors.categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{type === "income" ? "Choose a source" : "Choose a category"}</option>
            {kindCategories.map((c) => option({ id: c.id, label: c.name, archived: c.archived }))}
          </SelectField>
        )}
        {type === "transfer" ? (
          <SelectField name="counterAccountId" label="To" value={counterAccountId} error={errors.counterAccountId} onChange={(e) => setCounterAccountId(e.target.value)}>
            <option value="">Choose an account</option>
            {usableAccounts.filter((a) => a.id !== accountId).map(option)}
          </SelectField>
        ) : (
          <SelectField name="accountId" label={type === "income" ? "Received into" : "Paid from"} value={accountId} error={errors.accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose an account</option>
            {usableAccounts.map(option)}
          </SelectField>
        )}
      </div>
      {type === "expense" && account?.kind === "bank" && (
        <SelectField name="paymentMode" label="Payment mode (optional)" value={paymentMode} error={errors.paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
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
          error={errors.frequency}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
          hint={editing ? "To change it, end this one and add a new one." : undefined}
        >
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </SelectField>
        <TextField name="startDate" type="date" label="Starts on" value={startDate} disabled={editing} error={errors.startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} />
        <TextField name="endDate" type="date" label="Ends on (optional)" value={endDate} min={startDate} error={errors.endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {scheduleText({ frequency, startDate })}
        {anchorDayMayMove({ frequency, startDate }) ? ", or the month's last day when it is shorter" : ""}. Nothing is saved by itself: each one shows under Upcoming for you to confirm.
      </p>
      <TextField name="note" label="Note" placeholder="e.g. Flat rent" maxLength={280} value={note} error={errors.note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-2 flex justify-end gap-3">
        <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Cancel</DialogClose>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Add recurring"}
        </Button>
      </div>
    </form>
  )
}

function SkipForm({ item, onDone }: { item: RecurringItem; onDone: () => void }) {
  // One key per opened form; a retry after a failure reuses it, so the date is skipped once.
  const [requestKey] = useState(newRequestKey)
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="grid gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        if (pending) return
        setPending(true)
        const result = await run(() => skipOccurrenceAction({ ruleId: item.rule.id, occurrenceDate: item.date ?? "", reason, idempotencyKey: requestKey }))
        setPending(false)
        if (result.status === "success") {
          toast.success(result.message)
          onDone()
        } else setError(result.fieldErrors?.reason ?? result.message)
      }}
    >
      <ul className="grid list-disc gap-1.5 pl-5 text-sm text-muted-foreground">
        <li>Nothing is saved for this date.</li>
        <li>Use it when you already added the entry by hand, or it didn&apos;t happen this time.</li>
        <li>You can undo it while it is the latest date handled.</li>
      </ul>
      {error && <FormMessage tone="error">{error}</FormMessage>}
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

function ArchiveForm({ item, onDone }: { item: RecurringItem; onDone: () => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="grid gap-5">
      <ul className="grid list-disc gap-1.5 pl-5 text-sm text-muted-foreground">
        <li>It stops showing under Upcoming and leaves the cost totals.</li>
        <li>Entries it already saved stay in your history and totals.</li>
        <li>You can restore it later.</li>
      </ul>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className="flex justify-end gap-3">
        <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Cancel</DialogClose>
        <Button
          size="lg"
          disabled={pending}
          aria-busy={pending}
          onClick={async () => {
            setPending(true)
            const result = await run(() => setRecurringRuleArchivedAction({ ruleId: item.rule.id, archived: true }))
            setPending(false)
            if (result.status === "success") {
              toast.success(result.message)
              onDone()
            } else setError(result.message)
          }}
        >
          {pending ? "Archiving…" : "Archive"}
        </Button>
      </div>
    </div>
  )
}

