"use client"

import { useState } from "react"
import { setImportPayeesConsentAction } from "@/app/(app)/transactions/import/upi/actions"
import { Button } from "@/components/ui/button"
import { FormMessage } from "@/components/ui/field"

/**
 * Whether payee names from an imported UPI statement may be sent to Anthropic to suggest categories
 * (profiles.import_payees_ok_at, Sprint 9e). Given in the import's prompt; withdrawn (or given) here.
 * Independent of Roma.
 */
export function ImportPayeesSetting({ allowedAt: initial, timeZone }: { allowedAt: string | null; timeZone: string }) {
  const [allowedAt, setAllowedAt] = useState(initial)
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle")
  const allowed = allowedAt !== null
  const since = allowedAt ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(allowedAt)) : null

  async function toggle() {
    setState("busy")
    const result = await setImportPayeesConsentAction(!allowed).catch(() => null)
    if (!result?.ok) return setState("failed")
    setAllowedAt(result.at)
    setState("idle")
  }

  return (
    <div className="mt-4 grid gap-3">
      {state === "failed" && <FormMessage tone="error">We couldn’t change this setting. Please try again.</FormMessage>}
      <p className="text-sm text-ink">
        Payee names for category suggestions: <strong>{allowed ? "sent" : "not sent"}</strong>
        {since ? ` (allowed on ${since})` : ""}.{" "}
        {allowed
          ? "When a UPI statement has payees our rules don't cover, their names are sent to Anthropic to suggest categories."
          : "UPI statements are imported with rules only; you're asked again at your next import."}
      </p>
      <div>
        <Button variant="secondary" disabled={state === "busy"} onClick={() => void toggle()}>
          {allowed ? "Stop sending payee names" : "Allow payee names"}
        </Button>
      </div>
    </div>
  )
}
