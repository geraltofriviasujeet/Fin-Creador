"use client"

import { useMemo, useState } from "react"
import { type GoalItem, type WriteResult, newRequestKey } from "@fin-creador/api"
import { GOAL_TYPES, type GoalType, TRIP_COST_LINES, goalFigures, minorToInputString } from "@fin-creador/domain"
import {
  EMI_ROUNDING_NOTE,
  GOAL_TYPE_OPTIONS,
  GOAL_UPFRONT_LABEL,
  ITEM_PAYMENTS,
  LOAN_PAYMENTS,
  STAY_TYPES,
  TRAVEL_MODES,
  TRIP_COST_LABELS,
  goalFormSchema,
} from "@fin-creador/schemas"
import { cn } from "cn"
import { saveGoalAction } from "@/app/(app)/goals/actions"
import { AmountField } from "@/components/income/amount-field"
import { money } from "@/components/transactions/display"
import { Button } from "@/components/ui/button"
import { DialogClose } from "@/components/ui/dialog"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { GOAL_ICON } from "./display"

// Add or edit a planned expense: a short guided form per type. The figures shown while
// typing come from the same shared schema and domain code the server uses to save them.

type Values = Record<string, string>

const NETWORK = "We couldn't reach the server. Your details are kept; try again."
const PREVIEW_KEY = "00000000-0000-4000-8000-000000000000"

/** 850 → "8.5" (display of a stored rate, integer arithmetic only). */
function bpsToInput(bps: number | null): string {
  if (bps === null) return ""
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "")
  return fraction ? `${Math.floor(bps / 100)}.${fraction}` : String(Math.floor(bps / 100))
}

/** The stored answers back into the form's text fields. */
function valuesFrom(item: GoalItem): Values {
  const { goal, answers } = item
  const amount = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : minorToInputString(minor, goal.currency))
  const v: Values = {
    type: goal.type,
    name: goal.name,
    targetDate: goal.targetDate ?? "",
    saved: goal.savedMinor ? amount(goal.savedMinor) : "",
  }
  if (!answers) return v
  const d = answers.details as unknown as Record<string, unknown>
  switch (answers.type) {
    case "trip":
      Object.assign(v, {
        scope: answers.details.scope,
        place: answers.details.place,
        people: String(answers.details.people),
        days: String(answers.details.days),
        travelMode: answers.details.travelMode,
        stay: answers.details.stay,
      })
      for (const line of TRIP_COST_LINES) v[`cost_${line}`] = answers.details.costs[line] ? amount(answers.details.costs[line]) : ""
      break
    case "car":
    case "house":
      Object.assign(v, {
        payment: answers.details.payment,
        price: amount(answers.details.priceMinor),
        downPayment: amount(answers.details.downPaymentMinor),
        rate: bpsToInput(answers.details.loanRateBps),
        months: answers.details.loanMonths ? String(answers.details.loanMonths) : "",
      })
      if (answers.type === "car") Object.assign(v, { condition: answers.details.condition, model: answers.details.model, extras: amount(answers.details.extrasMinor) || "" })
      else Object.assign(v, { purpose: answers.details.purpose, city: answers.details.city })
      break
    case "furniture":
    case "electronics":
    case "mobile":
      Object.assign(v, {
        item: answers.details.item,
        payment: answers.details.payment,
        price: amount(answers.details.priceMinor),
        rate: bpsToInput(answers.details.emiRateBps),
        months: answers.details.emiMonths ? String(answers.details.emiMonths) : "",
      })
      break
    case "other":
      Object.assign(v, { description: String(d.description ?? ""), amount: amount(goal.targetMinor) })
      break
  }
  return v
}

export function GoalForm({ currency, today, item, onDone }: { currency: string; today: string; item?: GoalItem; onDone: () => void }) {
  const editing = Boolean(item)
  const goalCurrency = item?.goal.currency ?? currency
  // One key per opened form; a retry after a failure reuses it, so the goal is added once.
  const [requestKey] = useState(newRequestKey)
  const [values, setValues] = useState<Values>(() => (item ? valuesFrom(item) : { type: "trip", scope: "domestic", payment: "cash" }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const type = (values.type ?? "trip") as GoalType
  const set = (name: string) => (value: string) => setValues((v) => ({ ...v, [name]: value }))

  // Live figures: the same parse the server runs (amounts in minor units, exact maths).
  const preview = useMemo(() => {
    const parsed = goalFormSchema({ currency: goalCurrency, today, currentTargetDate: item?.goal.targetDate ?? null }).safeParse({
      ...values,
      goalId: "",
      idempotencyKey: PREVIEW_KEY,
    })
    if (!parsed.success) return null
    return { targetMinor: parsed.data.targetMinor, figures: goalFigures({ type: parsed.data.type, details: parsed.data.details } as Parameters<typeof goalFigures>[0]) }
  }, [values, goalCurrency, today, item?.goal.targetDate])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setFormError(null)
    let result: WriteResult
    try {
      result = await saveGoalAction({ ...values, goalId: item?.goal.id ?? "", idempotencyKey: editing ? "" : requestKey })
    } catch {
      result = { status: "error", message: NETWORK }
    }
    setPending(false)
    if (result.status === "success") {
      toast.success(result.message)
      onDone()
      return
    }
    setFormError(result.message)
    setErrors(result.fieldErrors ?? {})
  }

  const text = (name: string, label: string, props: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField name={name} label={label} value={values[name] ?? ""} error={errors[name]} onChange={(e) => set(name)(e.target.value)} {...props} />
  )
  const amountField = (name: string, label: string, hint?: string) => (
    <AmountField key={`${type}-${name}`} compact name={name} label={label} currency={goalCurrency} defaultValue={values[name] ?? ""} error={errors[name]} onChange={set(name)} hint={hint} />
  )
  const select = (name: string, label: string, options: readonly { value: string; label: string }[], placeholder: string) => (
    <SelectField name={name} label={label} value={values[name] ?? ""} error={errors[name]} onChange={(e) => set(name)(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </SelectField>
  )
  /** Small segmented control (radio group) with its label above, like a field. */
  const choice = (name: string, label: string, options: readonly { value: string; label: string }[]) => (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-semibold text-ink">{label}</legend>
      <div role="radiogroup" aria-label={label} className="flex h-[36px] gap-0.5 rounded-lg bg-canvas p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={values[name] === o.value}
            onClick={() => set(name)(o.value)}
            className={cn(
              "flex flex-1 items-center justify-center rounded-md px-2 text-sm font-semibold whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-ring",
              values[name] === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-ink"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {errors[name] && <p className="text-xs font-medium text-danger">{errors[name]}</p>}
    </fieldset>
  )

  const loanFields = (payment: string, isItem = false) =>
    payment !== "cash" && payment !== "" ? (
      <>
        {(!isItem || payment === "emi") && text("rate", "Yearly interest rate (%)", { inputMode: "decimal", placeholder: "e.g. 8.5" })}
        {text("months", isItem ? "Number of EMIs" : "Loan tenure (months)", { inputMode: "numeric", placeholder: isItem ? "e.g. 6" : "e.g. 60" })}
      </>
    ) : null

  const row = (cols: 2 | 3 | 4, children: React.ReactNode) => (
    <div className={cn("grid items-start gap-3", cols === 2 && "md:grid-cols-2", cols === 3 && "md:grid-cols-3", cols === 4 && "md:grid-cols-4")}>{children}</div>
  )

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="-mx-1 grid min-h-0 flex-1 content-start gap-3.5 overflow-y-auto px-1 pb-1">
        {formError && <FormMessage tone="error">{formError}</FormMessage>}

        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm font-semibold text-ink">What are you planning?</legend>
          <div role="radiogroup" aria-label="What are you planning?" className="flex flex-wrap gap-1.5">
            {GOAL_TYPE_OPTIONS.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={t.value === type}
                disabled={editing && t.value !== type}
                onClick={() => {
                  setValues((v) => ({ type: t.value, name: v.name ?? "", targetDate: v.targetDate ?? "", saved: v.saved ?? "", scope: "domestic", payment: "cash" }))
                  setErrors({})
                }}
                className={cn(
                  "flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5",
                  t.value === type ? "border-ink bg-primary text-primary-foreground" : "border-line bg-surface text-ink hover:bg-canvas"
                )}
              >
                {GOAL_ICON[t.value]}
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>

        {row(
          3,
          <>
            {text("name", "Name", { placeholder: type === "trip" ? "e.g. Goa with family" : "e.g. New sofa", autoFocus: !editing, maxLength: 80 })}
            {text("targetDate", "Target date (optional)", { type: "date", min: today })}
            {amountField("saved", "Saved so far (optional)")}
          </>
        )}
        <p className="-mt-1.5 text-xs text-muted-foreground">
          No target date: the monthly saving assumes 12 months. You enter the saved amount yourself; it isn&apos;t linked to your accounts.
        </p>

        {type === "trip" && (
          <>
            {row(
              4,
              <>
                {choice("scope", "Trip", [
                  { value: "domestic", label: "Domestic" },
                  { value: "international", label: "International" },
                ])}
                {text("place", values.scope === "international" ? "Country" : "State", { maxLength: 80 })}
                {text("people", "People", { inputMode: "numeric" })}
                {text("days", "Days", { inputMode: "numeric" })}
              </>
            )}
            {row(
              2,
              <>
                {select("travelMode", "Travel by", TRAVEL_MODES, "Choose how you'll travel")}
                {select("stay", "Stay type", STAY_TYPES, "Choose where you'll stay")}
              </>
            )}
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-sm font-semibold text-ink">Your cost lines (totals for the whole trip)</legend>
              <div className="grid items-start gap-3 md:grid-cols-3">{TRIP_COST_LINES.map((line) => amountField(`cost_${line}`, TRIP_COST_LABELS[line]))}</div>
            </fieldset>
          </>
        )}

        {type === "car" && (
          <>
            {row(
              3,
              <>
                {choice("condition", "Car", [
                  { value: "new", label: "New" },
                  { value: "used", label: "Used" },
                ])}
                <div className="md:col-span-2">{text("model", "Which car", { placeholder: "Make and model", maxLength: 80 })}</div>
              </>
            )}
            {row(
              2,
              <>
                {amountField("price", "Price")}
                {amountField("extras", "Extras (optional)", "Registration, insurance, accessories; paid upfront")}
              </>
            )}
            {choice("payment", "Payment", LOAN_PAYMENTS)}
            {row(
              3,
              <>
                {values.payment === "loan_down_payment" && amountField("downPayment", "Down payment")}
                {loanFields(values.payment ?? "")}
              </>
            )}
          </>
        )}

        {type === "house" && (
          <>
            {row(
              3,
              <>
                {choice("purpose", "Plan", [
                  { value: "buy", label: "Buy" },
                  { value: "renovate", label: "Renovate" },
                ])}
                {text("city", "City", { maxLength: 80 })}
                {amountField("price", values.purpose === "renovate" ? "Cost" : "Price")}
              </>
            )}
            {choice("payment", "Payment", LOAN_PAYMENTS)}
            {row(
              3,
              <>
                {values.payment === "loan_down_payment" && amountField("downPayment", "Down payment")}
                {loanFields(values.payment ?? "")}
              </>
            )}
          </>
        )}

        {(type === "furniture" || type === "electronics" || type === "mobile") && (
          <>
            {row(
              2,
              <>
                {text("item", "Item", { maxLength: 80 })}
                {amountField("price", "Price")}
              </>
            )}
            {choice("payment", "Payment", ITEM_PAYMENTS)}
            {row(2, loanFields(values.payment ?? "", true))}
          </>
        )}

        {type === "other" &&
          row(
            2,
            <>
              {text("description", "What it's for", { maxLength: 280 })}
              {amountField("amount", "Amount")}
            </>
          )}

        <div aria-live="polite" className="grid gap-1 rounded-xl bg-canvas px-3.5 py-3 text-sm">
          {preview ? (
            <>
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {type === "other" ? "Amount to save" : GOAL_UPFRONT_LABEL}
                  {preview.figures.costTotalMinor !== null && <span className="font-normal text-muted-foreground"> · the sum of your cost lines</span>}
                </span>
                <span className="font-heading text-lg font-bold tabular-nums">{money(preview.targetMinor, goalCurrency)}</span>
              </p>
              {preview.figures.loan && (
                <>
                  <p className="text-muted-foreground">
                    {preview.figures.loan.annualRateBps === 0 ? "No-cost EMI" : "EMI"} {money(preview.figures.loan.emiMinor, goalCurrency)} a month for {preview.figures.loan.months}{" "}
                    months on {money(preview.figures.loan.principalMinor, goalCurrency)} · total interest {money(preview.figures.loan.totalInterestMinor, goalCurrency)}
                  </p>
                  <p className="text-xs text-muted-foreground">{EMI_ROUNDING_NOTE}</p>
                </>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Fill in the details to see the amount to save.</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
        <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Add goal"}
        </Button>
      </div>
    </form>
  )
}

export const isGoalType = (value: string): value is GoalType => (GOAL_TYPES as readonly string[]).includes(value)
