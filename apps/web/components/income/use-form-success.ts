"use client"

import { useEffect } from "react"
import { toast } from "@/components/ui/toast"
import type { FormState } from "@/lib/form-state"

/** After a successful save: toast (the balance card when the save moved an account) and close the dialog. */
export function useFormSuccess(state: FormState, onDone: () => void) {
  useEffect(() => {
    if (state.status !== "success") return
    toast.saved(state.message ?? "Saved.", state.balances)
    onDone()
  }, [state, onDone])
}
