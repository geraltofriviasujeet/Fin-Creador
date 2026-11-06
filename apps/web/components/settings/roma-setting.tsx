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

/**
 * Whether Roma may send transaction descriptions (profiles.roma_descriptions_ok_at), shown
 * only while Roma is on. Withdrawing leaves Roma on; turning Roma off also withdraws it.
 */
export function RomaDescriptionsSetting({
  action,
  allowedAt,
  timeZone,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>
  allowedAt: string | null
  timeZone: string
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState)
  const allowed = allowedAt !== null
  const since = allowedAt
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(allowedAt))
    : null
  return (
    <form action={formAction} className="mt-4 grid gap-3 border-t border-line pt-4">
      {state.status !== "idle" && state.message && <FormMessage tone={state.status}>{state.message}</FormMessage>}
      <p className="text-sm text-ink">
        Transaction descriptions: <strong>{allowed ? "sent" : "not sent"}</strong>
        {since ? ` (allowed on ${since})` : ""}. {allowed ? "Searches send up to 20 matching descriptions." : "Searches answer without them."}
      </p>
      <input type="hidden" name="allowed" value={allowed ? "false" : "true"} />
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {allowed ? "Stop sending descriptions" : "Allow descriptions"}
        </Button>
      </div>
    </form>
  )
}
