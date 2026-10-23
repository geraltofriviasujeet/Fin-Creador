"use client"

import { useState } from "react"
import { cn } from "cn"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DialogClose } from "@/components/ui/dialog"
import { FormMessage, TextField } from "@/components/ui/field"
import type { DemoEntry } from "./demo-data"
import { TYPE_NOUN, accountChipText, entryKindLabel, entryTitle, fullDate, paymentModeLabel, signedAmount } from "./display"
import type { Lookup } from "./filters"
import type { SaveResult } from "./transaction-form"

function EntrySummary({ entry, lookup }: { entry: DemoEntry; lookup: Lookup }) {
  return (
    <div className="grid gap-1 rounded-xl bg-canvas px-4 py-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{entryTitle(entry, lookup)}</span>
        <span className="font-semibold tabular-nums">{signedAmount(entry)}</span>
      </div>
      <span className="text-xs text-muted-foreground">
        {entryKindLabel(entry, lookup)} · {accountChipText(entry, lookup)} · {fullDate(entry.occurredOn)}
      </span>
    </div>
  )
}

/** Void confirmation: one-way, optional reason, the entry stays in history. */
export function VoidForm({
  entry,
  lookup,
  onVoid,
}: {
  entry: DemoEntry
  lookup: Lookup
  onVoid: (reason: string | null) => Promise<SaveResult>
}) {
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const noun = TYPE_NOUN[entry.type]

  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={async (event) => {
        event.preventDefault()
        if (pending) return
        if (reason.trim().length > 200) return setError("Keep the reason under 200 characters.")
        setPending(true)
        setError(null)
        const result = await onVoid(reason.trim() || null)
        setPending(false)
        if (!result.ok) setError(result.message)
      }}
    >
      <EntrySummary entry={entry} lookup={lookup} />
      <ul className="grid list-disc gap-1.5 pl-5 text-sm text-muted-foreground">
        <li>It stops counting toward totals{entry.type === "transfer" ? "" : ` and ${noun} figures`}.</li>
        <li>
          {entry.type === "transfer"
            ? "Both accounts go back to their balances without it."
            : "The account balance goes back to what it was without it."}
        </li>
        <li>It stays in your history, marked “Voided”. This can&apos;t be undone.</li>
      </ul>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <TextField
        name="reason"
        label="Reason (optional)"
        placeholder="e.g. Entered twice"
        maxLength={200}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Shown in the history. To correct details instead, use Edit."
      />
      <div className="flex justify-end gap-3">
        <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Keep it</DialogClose>
        <Button type="submit" variant="destructive" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Voiding…" : `Void ${noun}`}
        </Button>
      </div>
    </form>
  )
}

type Field = { label: string; value: (e: DemoEntry) => string }

/** Every version of an edited entry, oldest first, with what changed. */
export function HistoryList({ versions, lookup }: { versions: DemoEntry[]; lookup: Lookup }) {
  const fields: Field[] = [
    { label: "Amount", value: signedAmount },
    { label: "Date", value: (e) => fullDate(e.occurredOn) },
    { label: "Category", value: (e) => entryKindLabel(e, lookup) },
    { label: "Account", value: (e) => accountChipText(e, lookup) },
    { label: "Payment mode", value: (e) => paymentModeLabel(e.paymentMode) ?? "Not specified" },
    { label: "Note", value: (e) => e.note ?? "No note" },
  ]
  return (
    <ol className="grid gap-3">
      {versions
        .map((v, i) => ({ v, i }))
        .reverse()
        .map(({ v, i }) => {
          const latest = i === versions.length - 1
          const prev = i > 0 ? versions[i - 1] : undefined
          const changes = prev ? fields.filter((f) => f.value(prev) !== f.value(v)) : []
          return (
            <li key={v.id} className={cn("grid gap-2 rounded-xl border px-4 py-3", latest ? "border-line-strong" : "border-line")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Version {i + 1}</span>
                {latest && !v.voided && <Badge tone="positive">Current</Badge>}
                {latest && v.voided && <Badge tone="negative">Voided</Badge>}
                {!latest && <Badge tone="neutral">Replaced by an edit</Badge>}
              </div>
              {prev ? (
                <ul className="grid gap-1 text-sm">
                  {changes.map((f) => (
                    <li key={f.label}>
                      <span className="text-muted-foreground">{f.label}: </span>
                      <span className="line-through decoration-muted-foreground">{f.value(prev)}</span> → <span className="font-semibold">{f.value(v)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm">
                  {signedAmount(v)} · {entryKindLabel(v, lookup)} · {accountChipText(v, lookup)} · {fullDate(v.occurredOn)}
                  {v.note ? ` · ${v.note}` : ""}
                </p>
              )}
              {latest && v.voided && v.voidReason && <p className="text-xs text-muted-foreground">Reason: {v.voidReason}</p>}
            </li>
          )
        })}
    </ol>
  )
}
