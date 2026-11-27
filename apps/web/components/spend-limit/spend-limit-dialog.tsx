"use client"

import { useState } from "react"
import { type SpendLimit, type WriteResult, spendLimitLabel } from "@fin-creador/api"
import { minorToInputString } from "@fin-creador/domain"
import {
  SPEND_LIMIT_MAX_CUSTOM_DAYS,
  SPEND_LIMIT_MIN_CUSTOM_DAYS,
  SPEND_LIMIT_PERIOD_OPTIONS,
  type SpendLimitPeriod,
  firstFieldErrors,
  spendLimitFormSchema,
} from "@fin-creador/schemas"
import { cn } from "cn"
import { removeSpendLimitAction, saveSpendLimitAction } from "@/app/(app)/transactions/spend-limit-actions"
import { AmountField } from "@/components/income/amount-field"
import { Choice } from "@/components/loans/choice"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, SHEET_ACTIONS } from "@/components/ui/dialog"
import { FormMessage, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { useSaveTransition } from "@/lib/use-save-transition"

// The daily spend limit (decisions log 2026-11-24 "Daily spend limit"; web, pre-13b 2 PR 3).
// One dialog, opened from the Transactions page header and from the Safe to spend card: a
// period (1 day, 1 week, 1 month or a custom 2–365 days) and an amount; change or remove it
// any time. The shared schema checks the form here and the shared writer checks it again on
// the server; the database sets the currency and the period's first day.

const NETWORK = "We couldn't reach the server. Your details are kept; try again."

async function run(save: () => Promise<WriteResult>): Promise<WriteResult> {
  try {
    return await save()
  } catch {
    return { status: "error", message: NETWORK }
  }
}

/** "each week", or for a custom period "every 10 days" once the day count is a number. */
function per(period: SpendLimitPeriod, days: string): string {
  if (period !== "custom") return `each ${period}`
  return /^\d{1,3}$/.test(days.trim()) ? `every ${Number(days)} days` : "in each period"
}

export type SpendLimitButtonProps = {
  /** The saved limit, or null when none is set. */
  limit: SpendLimit | null
  /** The profile currency (the database saves the limit in it). */
  currency: string
  /** "header": the Transactions page button; "card": the small link on the dark Safe to spend card. */
  variant: "header" | "card"
}

/** The button or link that opens the spend limit dialog. */
export function SpendLimitButton({ limit, currency, variant }: SpendLimitButtonProps) {
  const [open, setOpen] = useState(false)
  const label = limit ? spendLimitLabel(limit) : null
  return (
    <>
      {variant === "header" ? (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          aria-label={label ? `Limit ${label}. Change daily spend limit` : undefined}
          onClick={() => setOpen(true)}
        >
          {label ? `Limit ${label}` : "Set daily spend limit"}
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-[44px] w-fit items-center text-sm font-semibold text-nav-text underline underline-offset-4 outline-none hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand md:min-h-0"
        >
          {limit ? "Change limit" : "Set a daily limit"}
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent
            eyebrow="Daily spend limit"
            title={limit ? "Change your spend limit" : "Set a spend limit"}
            description="One cap for everyday spending. Bills, EMIs, card payments and transfers don't count. Safe to spend shows what's left for each day."
          >
            <SpendLimitForm limit={limit} currency={currency} onDone={() => setOpen(false)} />
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

function SpendLimitForm({ limit, currency, onDone }: { limit: SpendLimit | null; currency: string; onDone: () => void }) {
  const [period, setPeriod] = useState<SpendLimitPeriod>(limit?.period ?? "week")
  const [days, setDays] = useState(limit?.period === "custom" && limit.periodDays ? String(limit.periodDays) : "")
  const [amount, setAmount] = useState(limit ? minorToInputString(limit.amountMinor, limit.currency) : "")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, save] = useSaveTransition()

  const succeeded = (result: WriteResult) => () => {
    toast.success(result.message)
    onDone()
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    const values = { period, days, amount }
    const checked = spendLimitFormSchema({ currency }).safeParse(values)
    if (!checked.success) {
      setErrors(firstFieldErrors(checked.error))
      return
    }
    setErrors({})
    save(async () => {
      const result = await run(() => saveSpendLimitAction(values))
      if (result.status === "success") return succeeded(result)
      // Everything typed stays in the form.
      return () => {
        setFormError(result.message)
        setErrors(result.fieldErrors ?? {})
      }
    })
  }

  function remove() {
    setFormError(null)
    save(async () => {
      const result = await run(() => removeSpendLimitAction())
      if (result.status === "success") return succeeded(result)
      return () => setFormError(result.message)
    })
  }

  if (confirming) {
    return (
      <div className="grid gap-5">
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
        <p className="text-sm text-ink">
          Remove your limit of <span className="font-semibold">{limit ? spendLimitLabel(limit) : ""}</span>? Safe to spend goes back to what you can spend each day after your bills.
        </p>
        <div className={`flex flex-wrap justify-end gap-2 ${SHEET_ACTIONS}`}>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
            Keep limit
          </Button>
          <Button type="button" variant="destructive" size="lg" disabled={pending} aria-busy={pending} onClick={remove}>
            {pending ? "Removing…" : "Remove limit"}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      {limit && limit.currency !== currency && (
        <FormMessage tone="info">
          This limit is in {limit.currency}, so Safe to spend doesn&apos;t use it. Save it again in {currency}.
        </FormMessage>
      )}
      <Choice
        name="period"
        legend="Period"
        value={period}
        options={SPEND_LIMIT_PERIOD_OPTIONS}
        onChange={(v) => {
          setPeriod(v)
          setErrors((e) => {
            const next = { ...e }
            delete next.days
            return next
          })
        }}
        error={errors.period}
        hint={limit ? "Changing the period starts a new one from today. Changing only the amount keeps the current one." : undefined}
      />
      <div className={cn("grid items-start gap-3", period === "custom" && "md:grid-cols-[1fr_2fr]")}>
        {period === "custom" && (
          <TextField
            name="days"
            label="Number of days"
            inputMode="numeric"
            autoComplete="off"
            maxLength={3}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            error={errors.days}
            hint={`${SPEND_LIMIT_MIN_CUSTOM_DAYS} to ${SPEND_LIMIT_MAX_CUSTOM_DAYS}`}
          />
        )}
        <AmountField name="amount" label="Amount" currency={currency} defaultValue={amount} onChange={setAmount} error={errors.amount} hint={`You can spend this much ${per(period, days)}.`} autoFocus />
      </div>
      <div className={`flex flex-wrap items-center justify-between gap-2 ${SHEET_ACTIONS}`}>
        {limit ? (
          <Button type="button" variant="ghost" className="text-danger" disabled={pending} onClick={() => setConfirming(true)}>
            Remove limit
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-2">
          <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
          <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  )
}
