"use client"

import { useMemo, useState } from "react"
import { type LoanItem, type LoanWriteResult, type RevisionPreview, newRequestKey } from "@fin-creador/api"
import { type LoanType, loanSchedule, minorToGroupedInputString, regroupAmountInput, scheduleTotals } from "@fin-creador/domain"
import { LENDERS, LOAN_RATE_KIND_OPTIONS, LOAN_TYPE_OPTIONS, MORATORIUM_INTEREST_OPTIONS, loanFormSchema } from "@fin-creador/schemas"
import { addLoanAction, previewLoanRevisionAction, reviseLoanAction } from "@/app/(app)/loans-liabilities/actions"
import { currencySymbol } from "@/components/income/format"
import { fullDate, money } from "@/components/transactions/display"
import { Button } from "@/components/ui/button"
import { DialogClose } from "@/components/ui/dialog"
import { FormMessage, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { Choice } from "./choice"
import { bpsToInput, inWords } from "./display"

// Add a loan in two steps (type, then lender and details), or correct one: the same form,
// pre-filled, checked as on the day the loan was added, saved through revise_loan after one
// confirm step (owed before and after, pending EMIs rebuilt). The EMI estimate and schedule
// preview use the same shared schema and domain maths as the server; the bank's own EMI may
// differ and overwrites the estimate.

const NETWORK = "We couldn't reach the server. Your details are kept; try again."
const PREVIEW_KEY = "00000000-0000-4000-8000-000000000000"
const STEP_ONE_FIELDS = new Set(["loanType", "typeOther"])

type Values = {
  loanType: string
  typeOther: string
  lender: string
  nickname: string
  sanctioned: string
  disbursed: string
  rate: string
  rateKind: string
  tenureMonths: string
  startMode: string
  outstanding: string
  remainingMonths: string
  nextDueDate: string
  thisMonthPaid: string
  firstEmiDate: string
  moratoriumMonths: string
  moratoriumInterest: string
  emi: string
}

const EMPTY: Values = {
  loanType: "",
  typeOther: "",
  lender: "",
  nickname: "",
  sanctioned: "",
  disbursed: "",
  rate: "",
  rateKind: "fixed",
  tenureMonths: "",
  startMode: "ongoing",
  outstanding: "",
  remainingMonths: "",
  nextDueDate: "",
  thisMonthPaid: "",
  firstEmiDate: "",
  moratoriumMonths: "",
  moratoriumInterest: "",
  emi: "",
}

const START_OPTIONS = [
  { value: "ongoing", label: "Ongoing" },
  { value: "starts_later", label: "Starts later" },
] as const

const THIS_MONTH_OPTIONS = [
  { value: "paid", label: "Already paid" },
  { value: "due", label: "Still due" },
] as const

async function call(save: () => Promise<LoanWriteResult>): Promise<LoanWriteResult> {
  try {
    return await save()
  } catch {
    return { status: "error", message: NETWORK }
  }
}

/** The add form's answers for a loan as it was added (amounts, dates and the EMI in use). */
function valuesFrom(item: LoanItem): Values {
  const l = item.loan
  const amount = (minor: number) => minorToGroupedInputString(minor, l.currency)
  const paidBefore = item.items.some((d) => d.kind === "loan_emi" && d.seq === 0)
  return {
    loanType: l.loanType,
    typeOther: l.typeOther ?? "",
    lender: l.lender,
    nickname: l.nickname ?? "",
    sanctioned: amount(l.sanctionedMinor),
    disbursed: amount(l.disbursedMinor),
    rate: bpsToInput(l.rateBps),
    rateKind: l.rateKind,
    tenureMonths: String(l.tenureMonths),
    startMode: l.startMode,
    outstanding: l.startMode === "ongoing" ? amount(l.openingOutstandingMinor) : "",
    remainingMonths: l.startMode === "ongoing" ? String(l.instalmentMonths) : "",
    nextDueDate: l.startMode === "ongoing" ? l.firstDueDate : "",
    thisMonthPaid: l.startMode === "ongoing" ? (paidBefore ? "paid" : "due") : "",
    firstEmiDate: l.startMode === "starts_later" ? l.firstDueDate : "",
    moratoriumMonths: l.moratoriumMonths > 0 ? String(l.moratoriumMonths) : "",
    moratoriumInterest: l.moratoriumInterest ?? "",
    emi: amount(l.emiMinor),
  }
}

export function AddLoanForm({ today, currency, onDone }: { today: string; currency: string; onDone: () => void }) {
  return <LoanForm today={today} currency={currency} onDone={onDone} />
}

/** The add form, pre-filled; figures and dates as on the day the loan was added. */
export function EditLoanForm({ item, onDone }: { item: LoanItem; onDone: () => void }) {
  return <LoanForm today={item.loan.trackingStartedOn} currency={item.loan.currency} item={item} onDone={onDone} />
}

function LoanForm({ today, currency, item, onDone }: { today: string; currency: string; item?: LoanItem; onDone: () => void }) {
  // One key per opened form; a retry after a failure reuses it, so the loan is added (or corrected) once.
  const [requestKey] = useState(newRequestKey)
  const [step, setStep] = useState<1 | 2>(item ? 2 : 1)
  const [values, setValues] = useState<Values>(() => (item ? valuesFrom(item) : EMPTY))
  // Until the person types an EMI, the field shows the estimate and the server calculates it.
  const [emiTouched, setEmiTouched] = useState(item ? item.loan.emiMinor !== item.loan.emiEstimateMinor : false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Editing: what saving will do, shown once before it is saved.
  const [confirm, setConfirm] = useState<RevisionPreview | null>(null)
  // With payments recorded, the repayment start, EMI dates and moratorium stay (the database refuses them too).
  const locked = item ? item.hasPayments || item.items.some((d) => d.status === "paid") : false
  const put = (name: keyof Values, value: string) => {
    setConfirm(null)
    setValues((v) => ({ ...v, [name]: value }))
  }
  const set = (name: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => put(name, e.target.value)
  const schema = useMemo(() => loanFormSchema({ today, currency }), [today, currency])
  const card = values.loanType === "credit_card_emi"

  const estimate = useMemo(() => {
    const parsed = schema.safeParse({ ...values, emi: "", idempotencyKey: PREVIEW_KEY })
    return parsed.success ? parsed.data : null
  }, [schema, values])

  const preview = useMemo(() => {
    const parsed = emiTouched ? schema.safeParse({ ...values, idempotencyKey: PREVIEW_KEY }) : null
    const l = parsed ? (parsed.success ? parsed.data : null) : estimate
    if (!l) return null
    const principalMinor = l.startMode === "ongoing" ? l.outstandingMinor : l.disbursedMinor + l.capitalisedMinor
    try {
      const rows = loanSchedule({ principalMinor, rateBps: l.rateBps, emiMinor: l.emiMinor, months: l.remainingMonths, firstDueDate: l.firstDueDate })
      return { emiMinor: l.emiMinor, ...scheduleTotals(rows) }
    } catch {
      return null
    }
  }, [schema, values, emiTouched, estimate])

  function nextStep() {
    if (!values.loanType) return setErrors({ loanType: "Choose a loan type" })
    if (values.loanType === "other" && !values.typeOther.trim()) return setErrors({ typeOther: "Say what kind of loan it is" })
    setErrors({})
    setStep(2)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (step === 1) return nextStep()
    if (pending) return
    setPending(true)
    setFormError(null)
    const input = { ...values, emi: emiTouched ? values.emi : "", idempotencyKey: requestKey }
    if (item && !confirm) {
      let checked: Awaited<ReturnType<typeof previewLoanRevisionAction>>
      try {
        checked = await previewLoanRevisionAction({ ...input, loanId: item.loan.id })
      } catch {
        checked = { status: "error", message: NETWORK }
      }
      setPending(false)
      if (checked.status === "success") {
        setErrors({})
        setConfirm(checked.preview)
        return
      }
      setFormError(checked.message)
      setErrors(checked.fieldErrors ?? {})
      return
    }
    const result = await call(() => (item ? reviseLoanAction({ ...input, loanId: item.loan.id }) : addLoanAction(input)))
    setPending(false)
    setConfirm(null)
    if (result.status === "success") {
      toast.success(result.message)
      onDone()
      return
    }
    setFormError(result.message)
    setErrors(result.fieldErrors ?? {})
    if (Object.keys(result.fieldErrors ?? {}).some((f) => STEP_ONE_FIELDS.has(f))) setStep(1)
  }

  const field = (name: keyof Values, label: string, props: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField name={name} label={label} value={values[name]} error={errors[name]} onChange={set(name)} autoComplete="off" {...props} />
  )
  const sym = currencySymbol(currency)
  const amount = { inputMode: "decimal" as const, placeholder: "0.00" }
  const months = { inputMode: "numeric" as const, placeholder: "e.g. 60" }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="-mx-1 grid min-h-0 flex-1 content-start gap-3.5 overflow-y-auto px-1 pb-1">
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
        {step === 1 ? (
          <>
            <Choice
              name="loanType"
              legend="Loan type"
              grid
              value={values.loanType}
              options={LOAN_TYPE_OPTIONS}
              error={errors.loanType}
              onChange={(v: LoanType) => put("loanType", v)}
            />
            {values.loanType === "other" && field("typeOther", "What kind of loan?", { placeholder: "e.g. Family loan", maxLength: 40, autoFocus: true })}
          </>
        ) : (
          <>
            {item && (
              <FormMessage tone="info">
                {locked
                  ? `Correct any figure as it was on ${fullDate(today)}, the day you added this loan. Payments are recorded, so the repayment start, EMI dates and moratorium stay as they are; payments already recorded don't change.`
                  : `Correct any figure as it was on ${fullDate(today)}, the day you added this loan.`}
              </FormMessage>
            )}
            <p className="text-sm">
              <span className="font-semibold">{LOAN_TYPE_OPTIONS.find((o) => o.value === values.loanType)?.label}</span>
              {values.loanType === "other" && values.typeOther && ` · ${values.typeOther}`}{" "}
              <Button type="button" variant="link" size="sm" onClick={() => setStep(1)}>
                Change
              </Button>
            </p>
            <div className="grid items-start gap-3 md:grid-cols-2">
              {field("lender", card ? "Card issuer" : "Lender", {
                list: "loan-lenders",
                placeholder: card ? "e.g. SBI Card" : "e.g. State Bank of India",
                maxLength: 80,
                autoFocus: true,
                hint: "Pick from the list or type any name",
              })}
              <datalist id="loan-lenders">
                {LENDERS.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
              {field("nickname", "Nickname (optional)", { placeholder: card ? "e.g. Phone EMI" : "e.g. Car loan", maxLength: 40, hint: "No card or account numbers" })}
            </div>
            <div className="grid items-start gap-3 md:grid-cols-2">
              {field("sanctioned", `Sanctioned amount (${sym})`, amount)}
              {field("disbursed", `Amount taken (${sym})`, {
                ...amount,
                hint: values.startMode === "ongoing" ? "If interest was added to the loan, enter what you owe now" : "Not more than the sanctioned amount",
              })}
            </div>
            <div className="grid items-start gap-3 md:grid-cols-3">
              {field("rate", "Interest rate (% a year)", { inputMode: "decimal", placeholder: "e.g. 8.5", hint: card ? "0 for a no-cost EMI" : "Up to 2 decimals" })}
              <Choice name="rateKind" legend="Rate" value={values.rateKind} options={LOAN_RATE_KIND_OPTIONS} error={errors.rateKind} onChange={(v) => put("rateKind", v)} />
              {field("tenureMonths", "Tenure (months)", months)}
            </div>
            <Choice name="startMode" legend="Repayment" value={values.startMode} options={START_OPTIONS} error={errors.startMode} disabled={locked} onChange={(v) => put("startMode", v)} />
            {values.startMode === "ongoing" ? (
              <>
                <div className="grid items-start gap-3 md:grid-cols-2">
                  {field(
                    "outstanding",
                    item ? `Owed on the day you added this loan (${sym})` : `Owed today (${sym})`,
                    { ...amount, hint: item ? `Principal outstanding on ${fullDate(today)}` : "Principal outstanding from your statement" },
                  )}
                  {field("remainingMonths", "EMIs left", { ...months, placeholder: "e.g. 48", hint: values.thisMonthPaid === "paid" ? "Not counting this month's" : "Counting this month's" })}
                </div>
                <div className="grid items-start gap-3 md:grid-cols-2">
                  <Choice
                    name="thisMonthPaid"
                    legend="This month's EMI"
                    value={values.thisMonthPaid}
                    options={THIS_MONTH_OPTIONS}
                    error={errors.thisMonthPaid}
                    disabled={locked}
                    onChange={(v) => put("thisMonthPaid", v)}
                  />
                  {field("nextDueDate", values.thisMonthPaid === "paid" ? "Next EMI date" : "This month's EMI date", { type: "date", hint: inWords(values.nextDueDate), disabled: locked })}
                </div>
              </>
            ) : (
              <>
                <div className="grid items-start gap-3 md:grid-cols-2">
                  {field("firstEmiDate", "First EMI date", { type: "date", min: today, hint: inWords(values.firstEmiDate), disabled: locked })}
                  {field("moratoriumMonths", "Moratorium (months)", { inputMode: "numeric", placeholder: "0", hint: "Months before EMIs start with no EMI", disabled: locked })}
                </div>
                {Number(values.moratoriumMonths) > 0 && (
                  <Choice
                    name="moratoriumInterest"
                    legend="Interest during the moratorium"
                    value={values.moratoriumInterest}
                    options={MORATORIUM_INTEREST_OPTIONS}
                    error={errors.moratoriumInterest}
                    disabled={locked}
                    hint={
                      values.moratoriumInterest === "capitalise" && estimate
                        ? `Interest added when EMIs start (estimate ${money(estimate.capitalisedMinor, currency)})`
                        : values.moratoriumInterest === "pay_monthly" && estimate
                          ? `About ${money(estimate.moratoriumMonthlyInterestMinor, currency)} a month until EMIs start`
                          : undefined
                    }
                    onChange={(v) => put("moratoriumInterest", v)}
                  />
                )}
              </>
            )}
            <TextField
              name="emi"
              label={`EMI (${sym})`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="Fill in the details to estimate"
              value={emiTouched ? values.emi : estimate ? minorToGroupedInputString(estimate.emiMinor, currency) : ""}
              error={errors.emi}
              onChange={(e) => {
                setEmiTouched(true)
                put("emi", e.target.value)
              }}
              onBlur={() => emiTouched && put("emi", regroupAmountInput(values.emi, currency))}
              hint={
                estimate
                  ? emiTouched
                    ? `Our estimate is ${money(estimate.emiMinor, currency)}. Your bank's EMI is used for the schedule.`
                    : "An estimate. Change it to your bank's EMI if it differs."
                  : "Calculated from the amount, rate and months. You can change it."
              }
              labelAside={
                emiTouched && estimate ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() => {
                      setConfirm(null)
                      setEmiTouched(false)
                    }}
                  >
                    Use estimate
                  </Button>
                ) : undefined
              }
            />
            {card && <p className="text-xs text-muted-foreground">A processing fee and GST go in the fees of the first payment.</p>}
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
        <div aria-live="polite" className="grid min-w-0 flex-1 basis-60 gap-0.5 text-sm">
          {confirm ? (
            <>
              <p className="font-semibold">Check before saving</p>
              <p className="tabular-nums">
                Owed now {money(confirm.owedBeforeMinor, currency)} → {money(confirm.owedAfterMinor, currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {confirm.rebuilt === 0 ? "No pending EMIs change" : `${confirm.rebuilt} pending ${confirm.rebuilt === 1 ? "EMI" : "EMIs"} will be rebuilt`}
                {confirm.hasHistory ? ". Payments already recorded don't change." : "."}
              </p>
            </>
          ) : step === 2 &&
            (preview ? (
              <>
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">EMI</span>
                  <span className="font-heading text-lg font-bold tabular-nums">{money(preview.emiMinor, currency)}</span>
                  <span className="text-xs text-muted-foreground">× {preview.instalments}</span>
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  Interest {money(preview.totalInterestMinor, currency)}
                  {preview.lastDueDate && ` · last EMI ${fullDate(preview.lastDueDate)}`}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Fill in the details to see the EMI and schedule.</p>
            ))}
        </div>
        <div className="flex shrink-0 gap-2">
          {confirm ? (
            <Button type="button" variant="secondary" onClick={() => setConfirm(null)}>
              Back
            </Button>
          ) : (
            <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
          )}
          {step === 1 ? (
            <Button type="submit" size="lg">
              Next
            </Button>
          ) : (
            <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
              {item ? (confirm ? (pending ? "Saving…" : "Save changes") : pending ? "Checking…" : "Review changes") : pending ? "Adding…" : "Add loan"}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
