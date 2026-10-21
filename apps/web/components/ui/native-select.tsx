import type * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "cn"
import { controlClasses } from "@/components/ui/input"

/** Native <select>: accessible and mobile-friendly for long lists (time zones, countries). */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(controlClasses, "appearance-none pr-10", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-subtle"
      />
    </div>
  )
}

export { NativeSelect }
