"use client"

import { useState } from "react"
import { type DueItem, type PaymentRecord, type WriteResult, newRequestKey } from "@fin-creador/api"
import { addMinor, minorToInputString, parseAmount, shortfallMinor } from "@fin-creador/domain"
import { type PayingAccount, shortfallMessage } from "@fin-creador/schemas"
import { clearDuePlanAction, editDuePaymentAction, payDueItemAction, planDueItemAction } from "@/app/(app)/loans-liabilities/actions"
import { currencySymbol } from "@/components/income/format"
import { money } from "@/components/transactions/display"
import { Button } from "@/components/ui/button"
import { DialogClose } from "@/components/ui/dialog"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { Choice } from "./choice"
import { inWords } from "./display"

// Pay an instalment ("Paid") or plan it ("Will pay later"), or change a payment. The split
// defaults from the schedule and every part can be changed. A payment the account can't cover
// is a warning: "Pay anyway" sends the same request (same key) with allowShortfall.

const NETWORK = "We couldn't reach the server. Your details are kept; try again."

type Mode = "paid" | "later"
const MODE_OPTIONS = [
  { value: "paid", label: "Paid" },
  { value: "later", label: "Will pay later" },
] as const

async function call<R extends WriteResult>(save: () => Promise<R>): Promise<R | { status: "error"; message: string }> {
  try {
    return await save()
  } catch {
    return { status: "error", message: NETWORK }
  }
}

const accountLabel = (a: PayingAccount) => `${a.name} · ${money(a.balanceMinor, a.currency)}`

export function PayForm({
  item,
  accounts,
  today,
  currency,
  payment,
  startMode = "paid",
  onDone,
}: {
  item: DueItem
  accounts: readonly PayingAccount[]
  today: string
  currency: string
  /** Changing this payment (its parts are voided and posted again together). */
  payment?: PaymentRecord
  startMode?: Mode
  onDone: () => void
}) {
  const [requestKey] = useState(newRequestKey)
  const eligible = accounts.filter((a) => a.currency === currency)
  const [mode, setMode] = useState<Mode>(payment ? "paid" : startMode)
  const split = payment ?? item.split
  const [values, setValues] = useState({
    accountId: payment?.accountId ?? item.plannedAccountId ?? eligible[0]?.id ?? "",
    paidOn: payment?.paidOn ?? today,
    plannedOn: item.plannedOn ?? today,
    principal: split ? minorToInputString(split.principalMinor, currency) : "",
    interest: split ? minorToInputString(split.interestMinor, currency) : "",
    fees: split && split.feesMinor > 0 ? minorToInputString(split.feesMinor, currency) : "",
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [serverShort, setServerShort] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const set = (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setServerShort(null)
    setValues((v) => ({ ...v, [name]: e.target.value }))
  }
  const sym = currencySymbol(currency)

  // Live total and warning (the server checks again).
  const parts = [values.principal, values.interest, values.fees].map((v) => parseAmount(v || "0", currency, { allowZero: true }))
  const total = parts.every((p) => p.ok) ? addMinor(...parts.map((p) => (p.ok ? p.minor : 0))) : null
  const account = eligible.find((a) => a.id === values.accountId)
  // Changing a payment: its old total is back in its account before the new one is checked.
  const available = account ? account.balanceMinor + (payment && payment.accountId === account.id ? addMinor(payment.principalMinor, payment.interestMinor, payment.feesMinor) : 0) : null
  const short = mode === "paid" && total !== null && available !== null ? shortfallMinor(available, total) : 0
  const warning = serverShort ?? (short > 0 && account ? shortfallMessage(short, account.name, currency) : null)

  async function submit(allowShortfall: boolean) {
    if (pending) return
    setPending(true)
    setFormError(null)
    let result: WriteResult & { shortfallMinor?: number }
    if (mode === "later") {
      result = await call(() => planDueItemAction({ dueItemId: item.id, accountId: values.accountId, plannedOn: values.plannedOn }))
    } else {
      const input = {
        dueItemId: item.id,
        accountId: values.accountId,
        paidOn: values.paidOn,
        principal: values.principal,
        interest: values.interest,
        fees: values.fees,
        allowShortfall: allowShortfall ? "true" : "",
        idempotencyKey: requestKey,
      }
      result = await call(() => (payment ? editDuePaymentAction({ ...input, paymentId: payment.id }) : payDueItemAction(input)))
    }
    setPending(false)
    if (result.status === "success") {
      toast.success(result.message)
      onDone()
      return
    }
    const fieldErrors = result.fieldErrors ?? {}
    if (result.shortfallMinor) {
      // Shown once, in the warning with "Pay anyway", not also under the account.
      setServerShort(fieldErrors.accountId ?? result.message)
      setErrors({ ...fieldErrors, accountId: "" })
      return
    }
    setFormError(result.message)
    setErrors(fieldErrors)
  }

  async function clearPlan() {
    if (pending) return
    setPending(true)
    const result = await call(() => clearDuePlanAction({ dueItemId: item.id }))
    setPending(false)
    if (result.status === "success") {
      toast.success(result.message)
      onDone()
    } else setFormError(result.message)
  }

  const field = (name: keyof typeof values, label: string, props: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField name={name} label={label} value={values[name]} error={errors[name] || undefined} onChange={set(name)} autoComplete="off" {...props} />
  )

  if (eligible.length === 0) {
    return (
      <div className="grid gap-3">
        <FormMessage tone="info">Add a bank, cash or other account on the Income page first. EMIs are paid from one of them.</FormMessage>
        <div className="flex justify-end">
          <DialogClose render={<Button type="button" variant="secondary" />}>Close</DialogClose>
        </div>
      </div>
    )
  }

  return (
    <form
      noValidate
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(false)
      }}
    >
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      {!payment && <Choice name="mode" legend="Status" value={mode} options={MODE_OPTIONS} onChange={(v) => setMode(v)} />}
      <SelectField
        name="accountId"
        label={mode === "paid" ? "Paid from" : "Will pay from"}
        value={values.accountId}
        error={errors.accountId || undefined}
        onChange={set("accountId")}
        hint="Bank, cash and other accounts, with balances"
      >
        {eligible.map((a) => (
          <option key={a.id} value={a.id}>
            {accountLabel(a)}
          </option>
        ))}
      </SelectField>
      {mode === "paid" ? (
        <>
          {field("paidOn", "Paid on", { type: "date", max: today, hint: inWords(values.paidOn) })}
          <div className="grid items-start gap-3 grid-cols-3">
            {field("principal", `Principal (${sym})`, { inputMode: "decimal" })}
            {field("interest", `Interest (${sym})`, { inputMode: "decimal" })}
            {field("fees", `Fees (${sym})`, { inputMode: "decimal", placeholder: "0" })}
          </div>
          <p className="text-xs text-muted-foreground">Principal moves to the loan; interest and fees are expenses. Change the split to match your statement.</p>
        </>
      ) : (
        field("plannedOn", "Pay on", { type: "date", min: today, hint: inWords(values.plannedOn) })
      )}

      {warning && (
        <div role="alert" className="grid gap-2 rounded-xl bg-chip-peach px-3 py-2.5 text-sm text-danger">
          <p className="font-semibold">{warning}.</p>
          <p className="text-ink">Choose another account, or pay anyway if you will add money first.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
        <p aria-live="polite" className="text-sm tabular-nums">
          {mode === "paid" && total !== null && (
            <>
              <span className="font-semibold">Total </span>
              <span className="font-heading text-lg font-bold">{money(total, currency)}</span>
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {mode === "later" && item.plannedOn && (
            <Button type="button" variant="ghost" disabled={pending} onClick={clearPlan}>
              Remove plan
            </Button>
          )}
          <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
          {mode === "paid" && warning ? (
            <Button type="button" size="lg" disabled={pending} aria-busy={pending} onClick={() => submit(true)}>
              {pending ? "Saving…" : "Pay anyway"}
            </Button>
          ) : (
            <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
              {pending ? "Saving…" : mode === "later" ? "Save plan" : payment ? "Save payment" : "Mark as paid"}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
