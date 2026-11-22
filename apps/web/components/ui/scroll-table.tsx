import type * as React from "react"
import { cn } from "cn"

// A wide table that scrolls sideways inside its own box (12a-3), so the page never does. Below
// md the first column (the row's name) stays pinned while the figures scroll under it. The pin
// classes are all max-md:, so from md up the table looks exactly as before. The box is a
// labelled, focusable region so keyboard users can scroll it too.
const PIN_FIRST_COLUMN =
  "max-md:[&_tr>*:first-child]:sticky max-md:[&_tr>*:first-child]:left-0 max-md:[&_tr>*:first-child]:z-[1] max-md:[&_tr>*:first-child]:bg-surface max-md:[&_tr>*:first-child]:shadow-[1px_0_0_var(--color-line)]"

export function ScrollTable({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      data-scroll-table=""
      className={cn("overflow-x-auto outline-none focus-visible:outline-2 focus-visible:outline-ring", PIN_FIRST_COLUMN, className)}
    >
      {children}
    </div>
  )
}
