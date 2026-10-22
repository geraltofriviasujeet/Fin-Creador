import { firstFieldErrors } from "@fin-creador/schemas";
import type { z } from "zod";

// Same shape as the web's FormState, so both clients show the same messages.
export type FormState = {
  status: "idle" | "error" | "info" | "success";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Machine-readable follow-up for the UI, e.g. offer to resend a confirmation email. */
  code?: "email_not_confirmed";
};

export const idle: FormState = { status: "idle" };

export function validate<S extends z.ZodType>(
  schema: S,
  input: unknown
): { ok: true; data: z.output<S> } | { ok: false; state: FormState } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    state: { status: "error", message: "Please fix the highlighted fields.", fieldErrors: firstFieldErrors(result.error) },
  };
}
