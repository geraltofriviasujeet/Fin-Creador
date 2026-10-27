"use client"

import { useState } from "react"
import type { WriteResult } from "@fin-creador/api"
import { Button } from "@/components/ui/button"
import { DialogClose } from "@/components/ui/dialog"
import { FormMessage } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"

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
  const [pending, setPending] = useState(false)
  async function go() {
    if (pending) return
    setPending(true)
    const result = await run(action)
    setPending(false)
    if (result.status === "success") {
      toast.success(result.message)
      onDone()
    } else setError(result.message)
  }
  return (
    <div className="grid gap-4">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className="flex flex-wrap justify-end gap-2">
        <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
        <Button type="button" variant={destructive ? "destructive" : "primary"} size="lg" disabled={pending} aria-busy={pending} onClick={go}>
          {pending ? pendingLabel : label}
        </Button>
      </div>
    </div>
  )
}
