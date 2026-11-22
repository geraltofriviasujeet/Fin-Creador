"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import type { VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { OFFLINE_REASON, useOnline } from "@/components/pwa/pwa-provider"
import { buttonVariants } from "./button-variants"

type IconSize = "icon" | "icon-sm"

type BaseProps = Omit<ButtonPrimitive.Props, "className"> & {
  className?: string
  /** Stays enabled offline (Sign out: it works without a connection). */
  availableOffline?: boolean
  variant?: VariantProps<typeof buttonVariants>["variant"]
}

/** Icon-only buttons must have an accessible name (design-spec §3). */
export type ButtonProps =
  | (BaseProps & { size?: Exclude<VariantProps<typeof buttonVariants>["size"], IconSize> })
  | (BaseProps & { size: IconSize; "aria-label": string })

/**
 * While offline (Sprint 12b) every submit button (Save, Add, …) except Sign out
 * (`availableOffline`) is disabled and says why, so
 * nothing unsaved ever looks saved: it stays focusable, names the reason to screen readers and
 * shows it on hover; the offline banner says the same.
 */
function Button({ className, variant, size, children, availableOffline = false, ...props }: ButtonProps) {
  const online = useOnline()
  const blocked = !online && props.type === "submit" && !availableOffline
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
      {...(blocked ? { disabled: true, focusableWhenDisabled: true, title: OFFLINE_REASON, "data-offline": "" } : {})}
    >
      {children}
      {blocked && <span className="sr-only"> ({OFFLINE_REASON})</span>}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
