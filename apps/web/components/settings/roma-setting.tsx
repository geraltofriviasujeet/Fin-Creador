"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { FormMessage } from "@/components/ui/field"
import { type FormState, initialFormState } from "@/lib/form-state"

/** Roma on or off for this person (profiles.roma_enabled). The page states what is sent. */
export function RomaSetting({
  action,
  enabled,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>
  enabled: boolean
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState)
  return (
    <form action={formAction} className="mt-4 grid gap-3">
      {state.status !== "idle" && state.message && <FormMessage tone={state.status}>{state.message}</FormMessage>}
      <p className="text-sm text-ink">
        Roma is <strong>{enabled ? "on" : "off"}</strong>.
      </p>
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <div>
        <Button type="submit" variant={enabled ? "secondary" : "primary"} disabled={pending}>
          {enabled ? "Turn Roma off" : "Turn Roma on"}
        </Button>
      </div>
    </form>
  )
}
