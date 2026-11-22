"use client"

import { useState } from "react"
import type { WriteResult } from "@fin-creador/api"
import { Button } from "@/components/ui/button"
import { DialogClose, SHEET_ACTIONS } from "@/components/ui/dialog"
import { FormMessage } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { useSaveTransition } from "@/lib/use-save-transition"

// Shared by the Loans & Liabilities dialogs: run a write, and a Cancel / confirm button pair.

const NETWORK = "We couldn't reach the server. Try again."

export async function run<R extends WriteResult>(save: () => Promise<R>): Promise<R | { status: "error"; message: string }> {
  try {
    return await save()
  } catch {
    return { status: "error", message: NETWORK }
  }
}

export function ConfirmAction({
  label,
  pendingLabel,
  destructive = false,
  action,
  onDone,
}: {
  label: string
  pendingLabel: string
  destructive?: boolean
  action: () => Promise<WriteResult>
  onDone: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  // Closes (and toasts) only once the page shows the change; an error keeps the dialog open.
  const [pending, save] = useSaveTransition()
  function go() {
    save(async () => {
      const result = await run(action)
      if (result.status !== "success") return () => setError(result.message)
      return () => {
        toast.success(result.message)
        onDone()
      }
    })
  }
  return (
    <div className="grid gap-4">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className={`flex flex-wrap justify-end gap-2 ${SHEET_ACTIONS}`}>
        <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
        <Button type="button" variant={destructive ? "destructive" : "primary"} size="lg" disabled={pending} aria-busy={pending} onClick={go}>
          {pending ? pendingLabel : label}
        </Button>
      </div>
    </div>
  )
}
