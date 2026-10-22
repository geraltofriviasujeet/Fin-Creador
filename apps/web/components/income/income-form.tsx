"use client"

import { useActionState, useState } from "react"
import { countsTowardBalance } from "@fin-creador/domain"
import { recordIncomeAction } from "@/app/(app)/income/actions"
import { AmountField } from "@/components/income/amount-field"
import { FormActions } from "@/components/income/form-actions"
import { newRequestKey, shortDate } from "@/components/income/format"
import { useFormSuccess } from "@/components/income/use-form-success"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { initialFormState } from "@/lib/form-state"
import type { IncomeAccount, IncomeSourceItem } from "@/lib/income/types"

type Props = {
  accounts: IncomeAccount[]
  sources: IncomeSourceItem[]
  today: string
  onDone: () => void
  onAddAccount: () => void
}

/** Add income (design-spec §9): amount, source, date, "Received into" account, note. */
export function IncomeForm({ accounts, sources, today, onDone, onAddAccount }: Props) {
  const [state, action, pending] = useActionState(recordIncomeAction, initialFormState)
  // One key per opened form: retries after an error reuse it, so the income is saved once.
  const [requestKey] = useState(newRequestKey)
  useFormSuccess(state, onDone)
  const v = state.values ?? {}
  const errors = state.fieldErrors ?? {}

  const [sourceId, setSourceId] = useState(v.sourceId ?? "")
  const [accountId, setAccountId] = useState(v.accountId ?? (accounts.length === 1 ? accounts[0]!.id : ""))
  const [accountTouched, setAccountTouched] = useState(false)
  const [occurredOn, setOccurredOn] = useState(v.occurredOn ?? today)

  const account = accounts.find((a) => a.id === accountId)
  const beforeOpening = account && occurredOn && !countsTowardBalance(occurredOn, account.openingBalanceDate)

  if (accounts.length === 0) {
    return (
      <div className="grid gap-4">
        <FormMessage tone="info">Add an account first, so we know where the money was received.</FormMessage>
        <Button type="button" onClick={onAddAccount}>
          Add an account
        </Button>
      </div>
    )
  }

  return (
    <form action={action} noValidate className="grid gap-5">
      <div role="group" aria-label="Transaction type" className="grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1">
        <span
          aria-disabled="true"
          className="flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-muted-foreground"
        >
          Expense <Badge tone="info">Soon</Badge>
        </span>
        <span aria-current="true" className="flex h-11 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          Income
        </span>
      </div>

      {state.status === "error" && state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <input type="hidden" name="idempotencyKey" value={requestKey} />

      <AmountField name="amount" label="Amount" currency={account?.currency ?? accounts[0]!.currency} defaultValue={v.amount} error={errors.amount} autoFocus />

      <div className="grid gap-5 md:grid-cols-2">
        <SelectField
          name="sourceId"
          label="Category"
          value={sourceId}
          error={errors.sourceId}
          onChange={(e) => {
            const id = e.target.value
            setSourceId(id)
            const fallback = sources.find((s) => s.id === id)?.defaultAccountId
            if (!accountTouched && fallback && accounts.some((a) => a.id === fallback)) setAccountId(fallback)
          }}
        >
          <option value="" disabled>
            Choose a source
          </option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
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

      <SelectField
        name="accountId"
        label="Received into"
        value={accountId}
        error={errors.accountId}
        onChange={(e) => {
          setAccountId(e.target.value)
          setAccountTouched(true)
        }}
      >
        <option value="" disabled>
          Choose an account
        </option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </SelectField>

      {beforeOpening && (
        <FormMessage tone="info">
          This counts as income, but not toward the balance: it&apos;s before the opening balance date (
          {shortDate(account.openingBalanceDate)}).
        </FormMessage>
      )}

      <TextField name="note" label="Note" placeholder="What was this for?" maxLength={280} defaultValue={v.note} error={errors.note} />

      <FormActions submit="Save income" busy="Saving…" pending={pending} />
    </form>
  )
}
