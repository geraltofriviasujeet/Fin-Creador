"use client"

import { type IsoDate, isIsoDate, occurrence, occurrencesBetween } from "@fin-creador/domain"
import { REPEAT_OPTIONS } from "@fin-creador/schemas"
import { cn } from "cn"
import { fullDate } from "./display"

export type RepeatValue = (typeof REPEAT_OPTIONS)[number]["value"]

/**
 * "Repeat this?" on the add income and add expense forms. A repeat saves a recurring rule
 * starting on the entry date, with this entry as its first occurrence; later dates show on
 * Recurring to confirm or skip (nothing is added by itself). Plain radios named `repeat`,
 * so the field works in a controlled form and in a FormData form alike.
 */
export function RepeatField({
  value,
  onChange,
  occurredOn,
  today,
  error,
}: {
  value: RepeatValue
  onChange: (value: RepeatValue) => void
  occurredOn: string
  today: IsoDate
  error?: string
}) {
  return (
    <fieldset className="grid gap-2" aria-describedby="repeat-hint">
      <legend className="mb-2 text-sm font-semibold text-ink">Repeat this?</legend>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-canvas p-1">
        {REPEAT_OPTIONS.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex h-11 cursor-pointer items-center justify-center rounded-lg px-1 text-center text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ring",
              value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-ink"
            )}
          >
            <input
              type="radio"
              name="repeat"
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
      <p id="repeat-hint" className={cn("text-xs", error ? "text-danger" : "text-muted-foreground")} aria-live="polite">
        {error ?? repeatHint(value, occurredOn, today)}
      </p>
    </fieldset>
  )
}

function repeatHint(value: RepeatValue, occurredOn: string, today: IsoDate): string {
  if (value === "once" || !isIsoDate(occurredOn) || occurredOn > today) return "Saved once. You can set up a repeat later on Recurring."
  const schedule = { frequency: value, startDate: occurredOn, endDate: null }
  const next = occurrence(schedule, 1)
  const every = value === "monthly" ? "month" : "year"
  if (next > today) {
    return `Saves this one now. From ${fullDate(next)}, it shows on Recurring every ${every} for you to confirm. Nothing is added by itself.`
  }
  const due = occurrencesBetween(schedule, next, today).length
  return `Saves this one for ${fullDate(occurredOn)}. The ${due === 1 ? "date" : `${due} dates`} since then will show on Recurring for you to confirm or skip. Nothing is added by itself.`
}
