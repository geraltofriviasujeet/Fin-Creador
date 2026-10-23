"use client"

import { useState } from "react"
import { type LedgerAccount, type LedgerCategory, type LedgerItem, balancesWithout, previewDraft } from "@fin-creador/api"
import { AMOUNT_ERROR_MESSAGES, type IsoDate, minorToInputString, parseAmount } from "@fin-creador/domain"
import { PAYMENT_MODES, type PaymentModeValue } from "@fin-creador/schemas"
import { cn } from "cn"
import { AmountField } from "@/components/income/amount-field"
import { newRequestKey } from "@/components/income/format"
import { Button } from "@/components/ui/button"
import { DialogClose } from "@/components/ui/dialog"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { fullDate, money } from "./display"

export type EntryType = LedgerItem["type"]

export type Draft = {
  type: EntryType
  amountMinor: number
  occurredOn: IsoDate
  accountId: string
  counterAccountId: string | null
  categoryId: string | null
  paymentMode: PaymentModeValue | null
  note: string | null
}

export type SaveResult = { ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string> }

const TYPES: { value: EntryType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
]

type Props = {
  /** Add a new entry of this type, or edit an existing one (its type is fixed). */
  mode: { kind: "add"; type: EntryType } | { kind: "edit"; entry: LedgerItem }
  accounts: LedgerAccount[]
  categories: LedgerCategory[]
  /** Fast entry: a new expense starts from the account of the latest expense. */
  lastExpenseAccountId?: string | null
  today: IsoDate
  onTypeChange?: (type: EntryType) => void
  onSave: (draft: Draft, requestKey: string) => Promise<SaveResult>
}

export function TransactionForm({ mode, accounts, categories, lastExpenseAccountId, today, onTypeChange, onSave }: Props) {
  const editing = mode.kind === "edit" ? mode.entry : null
  const [type, setType] = useState<EntryType>(editing?.type ?? (mode.kind === "add" ? mode.type : "expense"))
  // One key per opened form; a retry after a failure reuses it, so the entry is saved once.
  const [requestKey] = useState(newRequestKey)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [amount, setAmount] = useState(editing ? minorToInputString(editing.amountMinor, editing.currency) : "")
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "")
  const [occurredOn, setOccurredOn] = useState(editing?.occurredOn ?? today)
  // Fast entry: a new expense starts from the account used for the last expense, if still active.
  const lastExpenseAccount = accounts.find((a) => a.id === lastExpenseAccountId && !a.archived)?.id
  const [accountId, setAccountId] = useState(
    editing?.accountId ?? (type === "expense" && lastExpenseAccount ? lastExpenseAccount : "")
  )
  const [counterAccountId, setCounterAccountId] = useState(editing?.counterAccountId ?? "")
  const [paymentMode, setPaymentMode] = useState<string>(editing?.paymentMode ?? "")
  const [note, setNote] = useState(editing?.note ?? "")

  // Archived accounts and categories can't be chosen for new entries; an edit may keep the
  // one it already has.
  const usableAccounts = accounts.filter((a) => !a.archived || a.id === editing?.accountId || a.id === editing?.counterAccountId)
  const kindCategories = categories.filter((c) => c.kind === type && (!c.archived || c.id === editing?.categoryId))
  const account = accounts.find((a) => a.id === accountId)
  const counter = accounts.find((a) => a.id === counterAccountId)
  const currency = account?.currency ?? "INR"

  const parsed = parseAmount(amount, currency)
  const { moves, goesNegative, beforeOpening } = previewDraft({
    type,
    amountMinor: parsed.ok ? parsed.minor : null,
    occurredOn,
    account,
    counter,
    balances: balancesWithout(accounts, editing),
  })

  const noun = type === "income" ? "income" : type
  const accountLabel = type === "income" ? "Received into" : type === "transfer" ? "From" : "Paid from"

  function validate(): Draft | null {
    const next: Record<string, string> = {}
    if (!parsed.ok) next.amount = AMOUNT_ERROR_MESSAGES[parsed.error]
    if (type !== "transfer" && !categoryId) next.categoryId = type === "income" ? "Choose a source" : "Choose a category"
    if (!occurredOn) next.occurredOn = "Choose a date"
    else if (occurredOn > today) next.occurredOn = "The date can't be in the future"
    else if (occurredOn < "1970-01-01") next.occurredOn = "Choose a later date"
    if (!accountId) next.accountId = type === "income" ? "Choose where it was received" : "Choose an account"
    if (type === "transfer") {
      if (!counterAccountId) next.counterAccountId = "Choose an account"
      else if (counterAccountId === accountId) next.counterAccountId = "Choose a different account"
      else if (counter && account && counter.currency !== account.currency) next.counterAccountId = "Both accounts need the same currency"
    }
    if (note.length > 280) next.note = "Keep the note under 280 characters"
    setErrors(next)
    if (Object.keys(next).length > 0 || !parsed.ok) {
      setFormError("Please fix the highlighted fields.")
      return null
    }
    const draft: Draft = {
      type,
      amountMinor: parsed.minor,
      occurredOn,
      accountId,
      counterAccountId: type === "transfer" ? counterAccountId : null,
      categoryId: type === "transfer" ? null : categoryId,
      paymentMode: type === "expense" && account?.kind === "bank" && paymentMode ? (paymentMode as PaymentModeValue) : null,
      note: note.trim() || null,
    }
    if (
      editing &&
      draft.amountMinor === editing.amountMinor &&
      draft.occurredOn === editing.occurredOn &&
      draft.accountId === editing.accountId &&
      draft.counterAccountId === editing.counterAccountId &&
      draft.categoryId === editing.categoryId &&
      draft.paymentMode === editing.paymentMode &&
      draft.note === editing.note
    ) {
      setFormError("Nothing has changed yet.")
      return null
    }
    return draft
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return // a second click while saving does nothing
    setFormError(null)
    const draft = validate()
    if (!draft) return
    setPending(true)
    const result = await onSave(draft, requestKey)
    setPending(false)
    if (!result.ok) {
      setFormError(result.message)
      setErrors(result.fieldErrors ?? {})
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <div role="radiogroup" aria-label="Transaction type" className="grid grid-cols-3 gap-1 rounded-xl bg-canvas p-1">
        {TYPES.map((t) => {
          const checked = t.value === type
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={Boolean(editing) && !checked}
              onClick={() => {
                setType(t.value)
                setErrors({})
                setFormError(null)
                setCategoryId("")
                onTypeChange?.(t.value)
              }}
              className={cn(
                "flex h-11 items-center justify-center rounded-lg text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed",
                checked ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-ink"
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {editing && (
        <p className="-mt-2 text-xs text-muted-foreground">
          The type can&apos;t change. To turn this into another type, void it and add a new entry.
        </p>
      )}

      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <AmountField
        name="amount"
        label="Amount"
        currency={currency}
        defaultValue={amount}
        error={errors.amount}
        autoFocus={!editing}
        onChange={setAmount}
      />

      <div className="grid items-start gap-5 md:grid-cols-2">
        {type === "transfer" ? (
          <AccountSelect
            name="accountId"
            label="From"
            accounts={usableAccounts}
            value={accountId}
            onChange={setAccountId}
            error={errors.accountId}
          />
        ) : (
          <SelectField
            name="categoryId"
            label={type === "income" ? "Source" : "Category"}
            value={categoryId}
            error={errors.categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">{type === "income" ? "Choose a source" : "Choose a category"}</option>
            {kindCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived ? " (archived)" : ""}
              </option>
            ))}
          </SelectField>
        )}
        <TextField
          name="occurredOn"
          type="date"
          label="Date"
          max={today}
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
          error={errors.occurredOn}
        />
      </div>

      <div className="grid items-start gap-5 md:grid-cols-2">
        {type === "transfer" ? (
          <AccountSelect
            name="counterAccountId"
            label="To"
            accounts={usableAccounts.filter((a) => a.id !== accountId)}
            value={counterAccountId}
            onChange={setCounterAccountId}
            error={errors.counterAccountId}
          />
        ) : (
          <AccountSelect
            name="accountId"
            label={accountLabel}
            accounts={usableAccounts}
            value={accountId}
            onChange={setAccountId}
            error={errors.accountId}
          />
        )}
        {type === "expense" && account?.kind === "bank" && (
          <SelectField
            name="paymentMode"
            label="Payment mode (optional)"
            value={paymentMode}
            onChange={(e) => setPaymentMode(e.target.value)}
            hint="A label only. The account above is what changes."
          >
            <option value="">Not specified</option>
            {PAYMENT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </SelectField>
        )}
      </div>

      {beforeOpening.map((a) => (
        <FormMessage key={a.id} tone="info">
          {type === "transfer" ? "This transfer" : `This ${noun}`} is before the opening balance date of {a.label} (
          {fullDate(a.openingBalanceDate)}), so it doesn&apos;t change that balance
          {type === "transfer" ? "." : `. It still counts as ${type === "expense" ? "an expense" : "income"} on ${fullDate(occurredOn)}.`}
        </FormMessage>
      ))}

      {moves.length > 0 && (
        <div className="grid gap-1 rounded-xl bg-canvas px-3 py-2.5 text-xs text-muted-foreground" aria-live="polite">
          {moves.map((m) => (
            <p key={m.account.id} className="tabular-nums">
              <span className="font-semibold text-ink">{m.account.label}</span>: {money(m.before, m.account.currency)} →{" "}
              <span className={cn("font-semibold", m.after < 0 ? "text-danger" : "text-ink")}>{money(m.after, m.account.currency)}</span>
            </p>
          ))}
          {type === "transfer" && <p>A transfer moves money between your accounts. It isn&apos;t income or an expense.</p>}
        </div>
      )}

      {goesNegative && (
        <FormMessage tone="info">
          This takes {goesNegative.account.label} below zero. Check the amount, or record the cash you received first. You can
          still save it.
        </FormMessage>
      )}

      <TextField
        name="note"
        label="Note"
        placeholder={type === "transfer" ? "e.g. ATM withdrawal" : "What was this for?"}
        maxLength={280}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={errors.note}
      />

      <div className="mt-2 flex justify-end gap-3">
        <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Cancel</DialogClose>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : `Save ${noun}`}
        </Button>
      </div>
    </form>
  )
}

function AccountSelect({
  name,
  label,
  accounts,
  value,
  onChange,
  error,
}: {
  name: string
  label: string
  accounts: LedgerAccount[]
  value: string
  onChange: (id: string) => void
  error?: string
}) {
  return (
    <SelectField name={name} label={label} value={value} error={error} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose an account</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label}
        </option>
      ))}
    </SelectField>
  )
}
