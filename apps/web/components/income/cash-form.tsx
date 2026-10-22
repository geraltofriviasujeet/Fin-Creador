"use client"

import { useActionState } from "react"
import { accountBalance, minorToInputString } from "@fin-creador/domain"
import { updateCashOnHandAction } from "@/app/(app)/income/actions"
import { AmountField } from "@/components/income/amount-field"
import { FormActions } from "@/components/income/form-actions"
import { money } from "@/components/income/format"
import { submitWithoutReset } from "@/components/income/submit-without-reset"
import { useFormSuccess } from "@/components/income/use-form-success"
import { FormMessage } from "@/components/ui/field"
import { initialFormState } from "@/lib/form-state"
import type { IncomeAccount } from "@/lib/income/types"

/** "Update cash in hand": set the cash held now. A correction, not income. */
export function CashForm({ cash, onDone, onAddIncome }: { cash: IncomeAccount; onDone: () => void; onAddIncome: () => void }) {
  const [state, action, pending] = useActionState(updateCashOnHandAction, initialFormState)
  useFormSuccess(state, onDone)
  const balance = accountBalance(cash)
  return (
    <form onSubmit={submitWithoutReset(action)} noValidate className="grid gap-5">
      <p className="text-sm text-muted-foreground">Now: {money(balance, cash.currency)}</p>
      {state.status === "error" && state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <input type="hidden" name="accountId" value={cash.id} />
      <AmountField
        name="amount"
        label="Cash you have now"
        currency={cash.currency}
        defaultValue={state.values?.amount ?? minorToInputString(balance, cash.currency)}
        error={state.fieldErrors?.amount}
        hint="This corrects the amount; it isn't counted as income."
      />
      <p className="text-sm text-muted-foreground">
        Received cash as income?{" "}
        <button type="button" onClick={onAddIncome} className="font-semibold text-ink underline underline-offset-4">
          Add income
        </button>
      </p>
      <FormActions submit="Update cash in hand" busy="Updating…" pending={pending} />
    </form>
  )
}
