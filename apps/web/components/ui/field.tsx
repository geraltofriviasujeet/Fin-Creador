import type * as React from "react"
import { CircleAlert, Info } from "lucide-react"
import { cn } from "cn"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"

type ControlAria = {
  id: string
  "aria-describedby"?: string
  "aria-invalid"?: true
}

type FieldProps = {
  id: string
  label: string
  hint?: string
  error?: string
  className?: string
  /** Extra content beside the label, e.g. a "Forgot password?" link. */
  labelAside?: React.ReactNode
  children: (aria: ControlAria) => React.ReactNode
}

/** Label + control + hint/error, with ids wired for screen readers. */
function Field({ id, label, hint, error, className, labelAside, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined

  return (
    <div data-slot="field" className={cn("grid gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {labelAside}
      </div>
      {children({ id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true } : {}) })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-center gap-1.5 text-xs font-medium text-danger">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

type TextFieldProps = Omit<React.ComponentProps<"input">, "id"> &
  Pick<FieldProps, "label" | "hint" | "error" | "labelAside"> & { id?: string; name: string }

function TextField({ id, name, label, hint, error, labelAside, className, ...props }: TextFieldProps) {
  return (
    <Field id={id ?? name} label={label} hint={hint} error={error} labelAside={labelAside} className={className}>
      {(aria) => <Input name={name} {...aria} {...props} />}
    </Field>
  )
}

type SelectFieldProps = Omit<React.ComponentProps<"select">, "id"> &
  Pick<FieldProps, "label" | "hint" | "error"> & { id?: string; name: string }

function SelectField({ id, name, label, hint, error, className, children, ...props }: SelectFieldProps) {
  return (
    <Field id={id ?? name} label={label} hint={hint} error={error} className={className}>
      {(aria) => (
        <NativeSelect name={name} {...aria} {...props}>
          {children}
        </NativeSelect>
      )}
    </Field>
  )
}

type FormMessageProps = {
  tone: "error" | "info" | "success"
  children: React.ReactNode
  className?: string
}

/** Form-level message. Errors are announced assertively, others politely. */
function FormMessage({ tone, children, className }: FormMessageProps) {
  const Icon = tone === "error" ? CircleAlert : Info
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm",
        tone === "error" && "bg-chip-peach text-danger",
        tone === "info" && "bg-chip-blue text-ink",
        tone === "success" && "bg-chip-mint text-success",
        className
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

export { Field, TextField, SelectField, FormMessage }
