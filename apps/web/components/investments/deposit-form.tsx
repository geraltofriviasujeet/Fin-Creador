"use client"

import { useMemo, useState } from "react"
import { type DepositItem, type WriteResult, newRequestKey } from "@fin-creador/api"
import { FD_DEFAULT_COMPOUNDING, fdFigures, isIsoDate, minorToInputString } from "@fin-creador/domain"
import { FD_BANKS, FD_COMPOUNDING_OPTIONS, fixedDepositFormSchema } from "@fin-creador/schemas"
import { saveFixedDepositAction } from "@/app/(app)/investments/actions"
import { fullDate, money } from "@/components/transactions/display"
import { Button } from "@/components/ui/button"
import { DialogClose } from "@/components/ui/dialog"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"

// Add or edit a fixed deposit. The preview uses the same shared schema and domain maths the
// server and the Investments page use; nothing is a bank quote.

const NETWORK = "We couldn't reach the server. Your details are kept; try again."
const PREVIEW_KEY = "00000000-0000-4000-8000-000000000000"
export const FD_FORM_NOTE = "Interest is added to the deposit (cumulative). Estimate before tax and TDS; your bank's figure can differ slightly."

type Values = { bank: string; label: string; principal: string; rate: string; compounding: string; startDate: string; maturityDate: string }

/** 725 → "7.25" (integer arithmetic only). */
function bpsToInput(bps: number): string {
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "")
  return fraction ? `${Math.floor(bps / 100)}.${fraction}` : String(Math.floor(bps / 100))
}

/** The date in words beside a date field, so a browser's own format (e.g. MM/DD/YYYY) can't mislead. */
const inWords = (value: string) => (isIsoDate(value) ? fullDate(value) : undefined)

export function DepositForm({ today, item, onDone }: { today: string; item?: DepositItem; onDone: () => void }) {
  // One key per opened form; a retry after a failure reuses it, so the deposit is added once.
  const [requestKey] = useState(newRequestKey)
  const [values, setValues] = useState<Values>(() =>
    item
      ? {
          bank: item.bank,
          label: item.label ?? "",
          principal: minorToInputString(item.principalMinor, "INR"),
          rate: bpsToInput(item.rateBps),
          compounding: item.compounding,
          startDate: item.startDate,
          maturityDate: item.maturityDate,
        }
      : { bank: "", label: "", principal: "", rate: "", compounding: FD_DEFAULT_COMPOUNDING, startDate: today, maturityDate: "" },
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const set = (name: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [name]: e.target.value }))

  const preview = useMemo(() => {
    const parsed = fixedDepositFormSchema({ today }).safeParse({ ...values, depositId: "", idempotencyKey: PREVIEW_KEY })
    if (!parsed.success) return null
    return { ...fdFigures(parsed.data, today), started: parsed.data.startDate < today }
  }, [values, today])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setFormError(null)
    let result: WriteResult
    try {
      result = await saveFixedDepositAction({ ...values, depositId: item?.id ?? "", idempotencyKey: item ? "" : requestKey })
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

  const field = (name: keyof Values, label: string, props: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField name={name} label={label} value={values[name]} error={errors[name]} onChange={set(name)} autoComplete="off" {...props} />
  )

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="-mx-1 grid min-h-0 flex-1 content-start gap-3.5 overflow-y-auto px-1 pb-1">
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
        <div className="grid items-start gap-3 md:grid-cols-2">
          {field("bank", "Bank", { list: "fd-banks", placeholder: "e.g. State Bank of India", maxLength: 80, autoFocus: true })}
          <datalist id="fd-banks">
            {FD_BANKS.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          {field("label", "Label (optional)", { placeholder: "e.g. Emergency fund", maxLength: 40 })}
        </div>
        <div className="grid items-start gap-3 md:grid-cols-3">
          {field("principal", "Principal (₹)", { inputMode: "decimal", placeholder: "e.g. 1,00,000" })}
          {field("rate", "Interest rate (% a year)", { inputMode: "decimal", placeholder: "e.g. 7.25", hint: "Up to 2 decimals" })}
          <SelectField name="compounding" label="Interest added" value={values.compounding} error={errors.compounding} onChange={set("compounding")}>
            {FD_COMPOUNDING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="grid items-start gap-3 md:grid-cols-2">
          {field("startDate", "Start date", { type: "date", max: today, hint: inWords(values.startDate) })}
          {field("maturityDate", "Maturity date", { type: "date", min: values.startDate || undefined, hint: inWords(values.maturityDate) })}
        </div>
        <p className="text-xs text-muted-foreground">{FD_FORM_NOTE}</p>
      </div>

      {/* Sticky footer: the preview stays in view next to the buttons. */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
        <div aria-live="polite" className="grid min-w-0 flex-1 basis-60 gap-0.5 text-sm">
          {preview ? (
            <>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">At maturity</span>
                <span className="font-heading text-lg font-bold tabular-nums">{money(preview.maturityValueMinor, "INR")}</span>
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                Interest {money(preview.interestMinor, "INR")}
                {preview.started && ` · ${preview.matured ? "Matured" : `Worth ${money(preview.accruedValueMinor, "INR")} today`}`}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Enter the principal, rate and dates to see the maturity value.</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
          <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
            {pending ? "Saving…" : item ? "Save changes" : "Add fixed deposit"}
          </Button>
        </div>
      </div>
    </form>
  )
}
