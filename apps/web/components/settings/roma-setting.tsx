"use client"

import { useActionState, useState } from "react"
import { Button } from "@/components/ui/button"
import { FormMessage } from "@/components/ui/field"
import { ROMA_RETENTION } from "@/lib/ai/wording"
import { type FormState, initialFormState } from "@/lib/form-state"
import { deleteAllRomaConversationsAction } from "@/app/(app)/roma/actions"

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

/**
 * Roma's stored conversations (Sprint 10.3): the retention rule and deleting all of them at
 * once. `count` is null when it couldn't be read. Deleting asks once more in place.
 */
export function RomaConversationsSetting({ count: initialCount }: { count: number | null }) {
  const [count, setCount] = useState(initialCount)
  const [state, setState] = useState<"idle" | "confirm" | "deleting" | "deleted" | "failed">("idle")

  async function deleteAll() {
    setState("deleting")
    try {
      const { ok } = await deleteAllRomaConversationsAction()
      setState(ok ? "deleted" : "failed")
      if (ok) setCount(0)
    } catch {
      setState("failed")
    }
  }

  return (
    <div className="mt-4 grid gap-3 border-t border-line pt-4">
      <p className="text-sm text-ink">
        {count === null
          ? "Your conversations with Roma couldn’t be counted."
          : count === 0
            ? "You have no saved conversations with Roma."
            : `You have ${count} saved ${count === 1 ? "conversation" : "conversations"} with Roma.`}{" "}
        {ROMA_RETENTION}
      </p>
      {state === "deleted" && <FormMessage tone="success">All your conversations with Roma were deleted.</FormMessage>}
      {state === "failed" && <FormMessage tone="error">We couldn’t delete your conversations. Try again.</FormMessage>}
      {count !== 0 &&
        (state === "confirm" || state === "deleting" ? (
          <div className="grid gap-2 rounded-lg border border-line p-3">
            <p className="text-sm text-ink">Delete all your conversations with Roma? This can’t be undone.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="destructive" disabled={state === "deleting"} onClick={deleteAll}>
                {state === "deleting" ? "Deleting…" : "Delete all"}
              </Button>
              <Button type="button" variant="secondary" disabled={state === "deleting"} onClick={() => setState("idle")}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="button" variant="secondary" onClick={() => setState("confirm")}>
              Delete all conversations
            </Button>
          </div>
        ))}
    </div>
  )
}
