"use client"

import { useId, useState } from "react"
import { parseAmount } from "@fin-creador/domain"
import { tripPlaceScope } from "@fin-creador/schemas"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, FormMessage } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { type IntakeQuestion, intakeQuestions, modelsOf } from "@/lib/ai/plan/intake"
import { type PlanRequest, planRequest } from "@/lib/ai/plan/types"

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

  /** The plan with each answer in, or a message for the first answer that can't be used. */
  function build(): { plan: PlanRequest } | { error: string } {
    const plan: Record<string, unknown> = { ...draft }
    for (const q of questions) {
      const raw = (answers[q.field] ?? "").trim()
      if (skipped.has(q.field) || raw === "") {
        plan[q.field] = null
        continue
      }
      if (q.kind === "number") {
        const n = Number(raw)
        if (!Number.isInteger(n) || n < q.min || n > q.max) return { error: `${q.label} Enter a whole number from ${q.min} to ${q.max}, or skip it.` }
        plan[q.field] = n
      } else if (q.kind === "amount") {
        const parsed = parseAmount(raw, currency, { allowZero: true })
        if (!parsed.ok) return { error: `${q.label} Enter an amount, or skip it.` }
        plan[q.field] = parsed.minor
      } else if (q.kind === "month") {
        if (raw < q.min) return { error: "That month has passed. Choose this month or later, or skip it." }
        plan[q.field] = raw
      } else plan[q.field] = raw
    }
    // A model belongs to its make: a new make clears a model chosen for another.
    if (plan.kind === "purchase" && plan.item !== "house" && plan.make && plan.model && !modelsOf(plan.item as "bike" | "car", plan.make as string).includes(plan.model as string)) plan.model = null
    const parsed = planRequest.safeParse(plan)
    return parsed.success ? { plan: parsed.data } : { error: "Some answers couldn't be used. Check them, or skip them." }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const built = build()
    if ("error" in built) return setError(built.error)
    setError(null)
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
  make,
  currency,
  onChange,
  onSkip,
}: {
  id: string
  q: IntakeQuestion
  value: string
  skipped: boolean
  make: { item: "bike" | "car"; make: string | null } | null
  currency: string
  onChange: (v: string) => void
  onSkip: () => void
}) {
  const unlisted = (q.field === "destination" || q.field === "origin") && value.trim() !== "" && !tripPlaceScope(value)
  const hint = skipped ? "Skipped: this shows as no estimate." : unlisted ? "Not on the app's list, so it can't be priced on the web." : "hint" in q ? q.hint : undefined
  const aside = (
    <Button type="button" variant="ghost" size="sm" onClick={onSkip} disabled={skipped} aria-label={`Skip: ${q.label}`}>
      {skipped ? "Skipped" : "Skip"}
    </Button>
  )
  return (
    <Field id={id} label={q.label} hint={hint} labelAside={aside}>
      {(aria) => {
        const common = { ...aria, value: skipped ? "" : value, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange(e.target.value) }
        switch (q.kind) {
          case "text":
            return <Input {...common} autoComplete="off" maxLength={40} />
          case "month":
            return <Input {...common} type="month" min={q.min} />
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
