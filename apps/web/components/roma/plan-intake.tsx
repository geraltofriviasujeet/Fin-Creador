"use client"

import { useId, useState } from "react"
import { tripPlaceScope } from "@fin-creador/schemas"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, FormMessage } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { type IntakeQuestion, buildPlan, intakeQuestions, modelsOf } from "@/lib/ai/plan/intake"
import type { PlanRequest } from "@/lib/ai/plan/types"

// The plan intake (10.9): the questions still needed for a plan, written in code
// (lib/ai/plan/intake.ts), each with Skip. A skipped answer is sent as null and the lines
// that need it come back as "no estimate"; the plan still runs. Nothing here reaches Roma
// until "Make the plan" is pressed (each plan spends one question and its web lookups).

type Answers = Record<string, string>

type Props = {
  question: string
  draft: PlanRequest
  today: string
  currency: string
  pending: boolean
  onPlan: (plan: PlanRequest) => void
  /** Send the words as an ordinary question instead. */
  onAsk: () => void
  onCancel: () => void
}

export function PlanIntake({ question, draft, today, currency, pending, onPlan, onAsk, onCancel }: Props) {
  const questions = intakeQuestions(draft, today)
  // A question filled in from what was said (the origin) starts with that answer, to change or skip.
  const [answers, setAnswers] = useState<Answers>(() => Object.fromEntries(questions.flatMap((q) => ("initial" in q && q.initial ? [[q.field, q.initial]] : []))))
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  /** The question the message is about: its field is marked and named. */
  const [errorField, setErrorField] = useState<string | null>(null)
  const baseId = useId()
  const set = (field: string, value: string) => {
    setAnswers((a) => ({ ...a, [field]: value }))
    setSkipped((s) => {
      const next = new Set(s)
      next.delete(field)
      return next
    })
  }
  const skip = (field: string) => setSkipped((s) => new Set(s).add(field))

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const built = buildPlan(draft, answers, skipped, currency, today)
    if ("error" in built) {
      setError(built.error)
      setErrorField(built.field)
      return
    }
    setError(null)
    setErrorField(null)
    onPlan(built.plan)
  }

  const known = describe(draft)
  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4" aria-label="Plan questions">
        <div className="grid gap-1">
          <p className="text-sm font-semibold text-ink">{question}</p>
          <p className="text-sm text-muted-foreground">
            Roma can make an itemised plan: each cost with where it came from, then whether it fits.
            {known ? ` From your question: ${known}.` : ""}
            {questions.length > 0 ? " A few details first. Skip any you don’t know: those costs will show as no estimate." : ""}
          </p>
        </div>
        {questions.map((q) => (
          <IntakeField
            key={q.field}
            id={`${baseId}-${q.field}`}
            q={q}
            value={answers[q.field] ?? ""}
            skipped={skipped.has(q.field)}
            error={errorField === q.field ? (error ?? undefined) : undefined}
            make={draft.kind === "purchase" && draft.item !== "house" ? { item: draft.item, make: draft.make ?? answers.make ?? null } : null}
            currency={currency}
            onChange={(v) => set(q.field, v)}
            onSkip={() => skip(q.field)}
          />
        ))}
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <p className="text-xs text-muted-foreground">
          Web prices are what pages list today, not live fares or bookings. A plan uses up to 8 web lookups from your daily allowance.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Making the plan…" : "Make the plan"}
          </Button>
          <Button type="button" variant="secondary" onClick={onAsk} disabled={pending}>
            Ask as a question instead
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}

function IntakeField({
  id,
  q,
  value,
  skipped,
  error,
  make,
  currency,
  onChange,
  onSkip,
}: {
  id: string
  q: IntakeQuestion
  value: string
  skipped: boolean
  /** Why this answer can't be used, shown under it. */
  error: string | undefined
  make: { item: "bike" | "car"; make: string | null } | null
  currency: string
  onChange: (v: string) => void
  onSkip: () => void
}) {
  const unlisted = (q.field === "destination" || q.field === "origin") && value.trim() !== "" && !tripPlaceScope(value)
  const hint = skipped ? (q.kind === "month" ? q.skipped : "Skipped: this shows as no estimate.") : unlisted ? "Not on the app's list, so it can't be priced on the web." : "hint" in q ? q.hint : undefined
  const aside = (
    <Button type="button" variant="ghost" size="sm" onClick={onSkip} disabled={skipped} aria-label={`Skip: ${q.label}`}>
      {skipped ? "Skipped" : "Skip"}
    </Button>
  )
  return (
    <Field id={id} label={q.label} hint={hint} error={error} labelAside={aside}>
      {(aria) => {
        const common = { ...aria, value: skipped ? "" : value, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange(e.target.value) }
        switch (q.kind) {
          case "text":
            return <Input {...common} autoComplete="off" maxLength={40} />
          case "month":
            // Safari shows a text box for a month: a typed month is read in code (parseMonth).
            return <Input {...common} type="month" min={q.min} placeholder="e.g. March 2027" />
          case "number":
            return <Input {...common} type="number" inputMode="numeric" min={q.min} max={q.max} step={1} />
          case "amount":
            return <Input {...common} inputMode="decimal" placeholder={`Amount in ${currency}`} />
          case "choice":
            return (
              <NativeSelect {...common}>
                <option value="">Choose…</option>
                {q.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            )
          case "model": {
            const models = make ? modelsOf(make.item, make.make) : []
            return (
              <NativeSelect {...common} disabled={models.length === 0}>
                <option value="">{models.length === 0 ? "Choose the make first" : "Choose…"}</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </NativeSelect>
            )
          }
        }
      }}
    </Field>
  )
}

/** What the question already said, in a few words. */
function describe(d: PlanRequest): string {
  if (d.kind === "trip") {
    return [d.destination, d.month, d.nights !== null ? `${d.nights} ${d.nights === 1 ? "night" : "nights"}` : null, d.travellers !== null ? `${d.travellers} ${d.travellers === 1 ? "traveller" : "travellers"}` : null, d.style]
      .filter(Boolean)
      .join(", ")
  }
  return [d.item, d.make, d.model, d.month].filter(Boolean).join(", ")
}
