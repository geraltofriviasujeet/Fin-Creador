"use client"

import { useActionState, useState } from "react"
import { voidIncomeAction } from "@/app/(app)/income/actions"
import { money, shortDate } from "@/components/income/format"
import { useFormSuccess } from "@/components/income/use-form-success"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FormMessage, TextField } from "@/components/ui/field"
import { initialFormState } from "@/lib/form-state"
import type { IncomeAccount, IncomeEntryItem } from "@/lib/income/types"

/** This year's entries for one source, with a one-way void for mistakes. */
export function SourceEntries({
  entries,
  accounts,
  onDone,
}: {
  entries: IncomeEntryItem[]
  accounts: IncomeAccount[]
  onDone: () => void
}) {
  const [voiding, setVoiding] = useState<string | null>(null)
  const label = (id: string) => accounts.find((a) => a.id === id)?.label ?? "Account"

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No income from this source this year.</p>
  }

  return (
    <ul className="grid max-h-[60vh] gap-2 overflow-y-auto">
      {entries.map((e) => (
        <li key={e.id} className="rounded-xl border border-line p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-0.5">
              <p className="text-sm font-semibold">{shortDate(e.occurredOn)}</p>
              <p className="text-xs text-muted-foreground">{label(e.accountId)}</p>
              {e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}
            </div>
            <div className="grid justify-items-end gap-1">
              <p className={e.voided ? "text-sm font-semibold text-muted-foreground line-through" : "text-sm font-semibold text-success"}>
                +{money(e.amountMinor, e.currency)}
              </p>
              {e.voided ? (
                <Badge tone="neutral">Voided{e.voidReason ? `: ${e.voidReason}` : ""}</Badge>
              ) : (
                voiding !== e.id && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setVoiding(e.id)}>
                    Void
                  </Button>
                )
              )}
            </div>
          </div>
          {voiding === e.id && <VoidForm id={e.id} onCancel={() => setVoiding(null)} onDone={onDone} />}
        </li>
      ))}
    </ul>
  )
}

function VoidForm({ id, onCancel, onDone }: { id: string; onCancel: () => void; onDone: () => void }) {
  const [state, action, pending] = useActionState(voidIncomeAction, initialFormState)
  useFormSuccess(state, onDone)
  return (
    <form action={action} className="mt-3 grid gap-3 border-t border-line pt-3">
      <input type="hidden" name="transactionId" value={id} />
      <p className="text-sm">Void this income? It stays in history but no longer counts. This can&apos;t be undone.</p>
      {state.status === "error" && state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <TextField name="reason" label="Reason" hint="Optional" maxLength={200} error={state.fieldErrors?.reason} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Keep it
        </Button>
        <Button type="submit" variant="destructive" size="sm" disabled={pending} aria-busy={pending}>
          {pending ? "Voiding…" : "Void income"}
        </Button>
      </div>
    </form>
  )
}
