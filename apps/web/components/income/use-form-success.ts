"use client"

import { useEffect } from "react"
import { toast } from "@/components/ui/toast"
import type { FormState } from "@/lib/form-state"

/** After a successful save: toast and close the dialog. */
export function useFormSuccess(state: FormState, onDone: () => void) {
  useEffect(() => {
    if (state.status !== "success") return
    toast.success(state.message ?? "Saved.")
    onDone()
  }, [state, onDone])
}
