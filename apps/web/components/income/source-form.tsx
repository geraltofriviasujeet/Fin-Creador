"use client"

import { useActionState } from "react"
import { SOURCE_TYPES } from "@fin-creador/schemas"
import { saveSourceAction } from "@/app/(app)/income/actions"
import { FormActions } from "@/components/income/form-actions"
import { submitWithoutReset } from "@/components/income/submit-without-reset"
import { useFormSuccess } from "@/components/income/use-form-success"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { initialFormState } from "@/lib/form-state"
import type { IncomeAccount } from "@/lib/income/types"

/** Add source: name, type and an optional default "Received into" account. */
export function SourceForm({ accounts, onDone }: { accounts: IncomeAccount[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveSourceAction, initialFormState)
  useFormSuccess(state, onDone)
  const v = state.values ?? {}
  const errors = state.fieldErrors ?? {}

  return (
    <form onSubmit={submitWithoutReset(action)} noValidate className="grid gap-5">
      {state.status === "error" && state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <TextField name="name" label="Name" placeholder="e.g. Shop rent" maxLength={60} defaultValue={v.name} error={errors.name} autoFocus />
      <SelectField name="sourceType" label="Type" defaultValue={v.sourceType ?? "other"} error={errors.sourceType}>
        {SOURCE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </SelectField>
      <SelectField
        name="defaultAccountId"
        label="Usually received into"
        hint="Optional. Pre-selected when you add income from this source."
        defaultValue={v.defaultAccountId ?? ""}
        error={errors.defaultAccountId}
      >
        <option value="">No default</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </SelectField>
      <FormActions submit="Add source" busy="Saving…" pending={pending} />
    </form>
  )
}
