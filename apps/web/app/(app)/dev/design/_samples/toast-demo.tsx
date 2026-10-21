"use client"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" onClick={() => toast.success("Expense saved", "Demo only — nothing was recorded.")}>
        Success toast
      </Button>
      <Button variant="secondary" onClick={() => toast.info("Heads up", "This is an informational toast.")}>
        Info toast
      </Button>
      <Button variant="secondary" onClick={() => toast.error("Couldn’t save", "Check your connection and try again.")}>
        Error toast
      </Button>
    </div>
  )
}
