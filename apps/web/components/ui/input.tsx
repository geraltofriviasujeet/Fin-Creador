import type * as React from "react"
import { cn } from "cn"

const controlClasses =
  "h-11 w-full min-w-0 rounded-lg border border-input bg-surface px-3 text-sm text-ink transition-colors outline-none placeholder:text-muted-subtle focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-canvas disabled:opacity-70 aria-invalid:border-danger read-only:bg-canvas"

function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input type={type} data-slot="input" className={cn(controlClasses, className)} {...props} />
  )
}

export { Input, controlClasses }
