import { Field } from "@/components/ui/field"
import { controlClasses } from "@/components/ui/input"
import { cn } from "cn"
import { currencySymbol } from "@/components/income/format"

/** Large amount input with the currency symbol inside (design-spec §6). Text, not number: no float parsing. */
export function AmountField({
  name,
  label,
  currency,
  defaultValue,
  error,
  hint,
  autoFocus,
}: {
  name: string
  label: string
  currency: string
  defaultValue?: string
  error?: string
  hint?: string
  autoFocus?: boolean
}) {
  return (
    <Field id={name} label={label} error={error} hint={hint}>
      {(aria) => (
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-heading text-xl font-semibold text-ink">
            {currencySymbol(currency)}
          </span>
          <input
            name={name}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            defaultValue={defaultValue}
            autoFocus={autoFocus}
            className={cn(controlClasses, "h-14 pl-10 font-heading text-2xl font-semibold tabular-nums")}
            {...aria}
          />
        </div>
      )}
    </Field>
  )
}
