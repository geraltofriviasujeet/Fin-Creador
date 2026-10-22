import type { z } from "zod"
import { firstFieldErrors } from "@fin-creador/schemas"

export type FormState = {
  status: "idle" | "error" | "info" | "success"
  message?: string
  fieldErrors?: Record<string, string>
  /** Submitted values echoed back so inputs keep their content after an error. Never passwords. */
  values?: Record<string, string>
  /** Machine-readable follow-up for the UI, e.g. offer to resend a confirmation email. */
  code?: "email_not_confirmed"
}

export const initialFormState: FormState = { status: "idle" }

/** Reads the named string fields from FormData. */
export function readFields(formData: FormData, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    names.map((name) => {
      const value = formData.get(name)
      return [name, typeof value === "string" ? value : ""]
    })
  )
}

/**
 * Validates `input` with a shared schema. On failure returns an error FormState holding
 * the first message per field and the echo-safe values.
 */
export function validate<S extends z.ZodType>(
  schema: S,
  input: Record<string, string>,
  echo: readonly string[]
): { ok: true; data: z.output<S> } | { ok: false; state: FormState } {
  const result = schema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }

  return {
    ok: false,
    state: {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: firstFieldErrors(result.error),
      values: pick(input, echo),
    },
  }
}

export function pick(input: Record<string, string>, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, input[k] ?? ""]))
}
