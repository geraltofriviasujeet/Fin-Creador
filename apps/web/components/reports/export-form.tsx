"use client"

import { type FormEvent, useState } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"

// CSV export form (Sprint 8c). A plain GET to /reports/export (works without JavaScript); with
// it, the file is fetched so the page can say "preparing", "nothing in this range", "narrow the
// range" or "try again" instead of leaving a broken download. The server checks everything again.

export const EXPORT_PATH = "/reports/export"

type Option = { id: string; label: string }
type State = { kind: "idle" } | { kind: "loading" } | { kind: "done"; rows: number } | { kind: "empty" } | { kind: "error"; message: string; narrow: boolean }

const OFFLINE = "We couldn't export your transactions. Check your connection and try again."

function filenameOf(res: Response): string {
  return /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "fincreador-transactions.csv"
}

export function ExportForm({
  defaultFrom,
  today,
  accounts,
  expenseCategories,
  incomeSources,
}: {
  defaultFrom: string
  today: string
  accounts: Option[]
  expenseCategories: Option[]
  incomeSources: Option[]
}) {
  const [state, setState] = useState<State>({ kind: "idle" })
  const [rangeError, setRangeError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (state.kind === "loading") return
    const form = new FormData(e.currentTarget)
    const from = String(form.get("from") ?? "")
    const to = String(form.get("to") ?? "")
    if (!from || !to || from > to) {
      setRangeError("Choose a start date on or before the end date.")
      return
    }
    setRangeError(null)
    const params = new URLSearchParams()
    for (const [k, v] of form) if (typeof v === "string" && v) params.set(k, v)
    setState({ kind: "loading" })
    try {
      const res = await fetch(`${EXPORT_PATH}?${params}`, { cache: "no-store" })
      if (!res.ok) {
        const message = (await res.text()).trim() || OFFLINE
        setState({ kind: "error", message, narrow: res.status === 413 })
        return
      }
      const rows = Number(res.headers.get("X-Row-Count") ?? "")
      if (rows === 0) {
        setState({ kind: "empty" })
        return
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement("a")
      a.href = url
      a.download = filenameOf(res)
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setState({ kind: "done", rows })
    } catch {
      setState({ kind: "error", message: OFFLINE, narrow: false })
    }
  }

  const loading = state.kind === "loading"
  return (
    <Card aria-labelledby="export-title" className="grid gap-4">
      <div>
        <CardTitle id="export-title">Export CSV</CardTitle>
        <CardDescription className="mt-1">
          Your entries as a spreadsheet file: date, type, amount, currency, accounts, category, payment mode and note. Edited entries appear once, as they are now.
        </CardDescription>
      </div>
      <form action={EXPORT_PATH} method="get" onSubmit={onSubmit} aria-busy={loading} className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField name="from" type="date" label="From" max={today} defaultValue={defaultFrom} required error={rangeError ?? undefined} />
          <TextField name="to" type="date" label="To" max={today} defaultValue={today} required />
          <SelectField name="account" label="Account (optional)" defaultValue="">
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </SelectField>
          <SelectField name="category" label="Category (optional)" defaultValue="">
            <option value="">All categories</option>
            {expenseCategories.length > 0 && (
              <optgroup label="Expenses">
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            )}
            {incomeSources.length > 0 && (
              <optgroup label="Income">
                {incomeSources.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            )}
          </SelectField>
        </div>
        <label className="flex min-h-10 items-center gap-2.5 text-sm">
          <input type="checkbox" name="voided" value="1" className="size-4 accent-(--color-ink)" />
          Include voided entries (marked “Yes” in the Voided column)
        </label>
        <p className="rounded-xl bg-canvas px-3 py-2 text-xs text-muted-foreground">
          Made safe for spreadsheets: a name or note that starts with = + − or @ gets a leading apostrophe, so Excel, Sheets or Numbers show it as text and
          never run it as a formula. Amounts stay plain numbers. Up to 10,000 entries per file; nothing is kept on our side.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={loading}>
            <Download aria-hidden="true" />
            {loading ? "Preparing…" : "Download CSV"}
          </Button>
        </div>
        <div aria-live="polite">
          {state.kind === "done" && (
            <FormMessage tone="success">
              Downloaded {state.rows.toLocaleString("en-IN")} {state.rows === 1 ? "entry" : "entries"}.
            </FormMessage>
          )}
          {state.kind === "empty" && <FormMessage tone="info">No entries match this range and filter, so there is nothing to download.</FormMessage>}
          {state.kind === "error" && (
            <FormMessage tone="error">
              {state.message}
              {state.narrow && " For example, export one year at a time."}
            </FormMessage>
          )}
        </div>
      </form>
    </Card>
  )
}
