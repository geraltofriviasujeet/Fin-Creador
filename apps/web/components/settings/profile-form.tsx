"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { type FormState, initialFormState } from "@/lib/form-state"

export type Option = { value: string; label: string }

type Values = { displayName: string; phone: string; country: string; currency: string; timeZone: string }

export function ProfileForm({
  action,
  defaults,
  countries,
  currencies,
  timeZones,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>
  defaults: Values
  countries: Option[]
  currencies: Option[]
  timeZones: Option[]
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState)
  const values = { ...defaults, ...state.values }
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} noValidate className="mt-6 grid gap-5">
      {state.status !== "idle" && state.message && <FormMessage tone={state.status}>{state.message}</FormMessage>}

      <div className="grid gap-5 md:grid-cols-2">
        <TextField
          name="displayName"
          label="Name"
          autoComplete="name"
          required
          defaultValue={values.displayName}
          error={errors.displayName}
        />
        <TextField
          name="phone"
          type="tel"
          label="Phone (optional)"
          autoComplete="tel"
          placeholder="+91 98765 43210"
          defaultValue={values.phone}
          error={errors.phone}
        />
        <SelectField name="country" label="Country" defaultValue={values.country} error={errors.country}>
          {countries.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <SelectField name="currency" label="Currency" defaultValue={values.currency} error={errors.currency}>
          {currencies.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          name="timeZone"
          label="Time zone"
          hint="Used for day, week and month boundaries and reminders."
          defaultValue={values.timeZone}
          error={errors.timeZone}
          className="md:col-span-2"
        >
          {timeZones.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  )
}
