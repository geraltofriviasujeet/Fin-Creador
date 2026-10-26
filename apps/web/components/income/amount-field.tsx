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
  onChange,
  compact = false,
}: {
  name: string
  label: string
  currency: string
  defaultValue?: string
  error?: string
  hint?: string
  autoFocus?: boolean
  onChange?: (value: string) => void
  /** Smaller control for forms with many amounts (e.g. a trip's cost lines). */
  compact?: boolean
}) {
  return (
    <Field id={name} label={label} error={error} hint={hint}>
      {(aria) => (
        <div className="relative">
          <span
            aria-hidden="true"
            className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 font-heading font-semibold text-ink", compact ? "left-3 text-sm" : "left-3.5 text-lg")}
          >
            {currencySymbol(currency)}
          </span>
          <input
            name={name}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            defaultValue={defaultValue}
            autoFocus={autoFocus}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            className={cn(controlClasses, "font-heading font-semibold tabular-nums", compact ? "pl-7 text-sm" : "h-[44px] pl-9 text-xl")}
            {...aria}
          />
        </div>
      )}
    </Field>
  )
}
