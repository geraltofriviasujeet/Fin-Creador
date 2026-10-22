"use client"

import type * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { cn } from "cn"

// Modal dialog (design-spec §6 and §9): eyebrow, title, close button, surface card with
// the raised shadow. Base UI traps focus, closes on Escape and restores focus on close.
// Animations are skipped under prefers-reduced-motion (globals.css).

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />
}

function DialogContent({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow?: string
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-ink/40 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <DialogPrimitive.Viewport className="fixed inset-0 z-50 grid items-end justify-items-center overflow-y-auto p-0 md:items-center md:p-4">
        <DialogPrimitive.Popup
          className={cn(
            "relative w-full max-w-xl rounded-t-3xl bg-surface p-6 text-ink shadow-(--shadow-raised) outline-none transition-[opacity,transform] duration-150 data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 md:rounded-3xl md:p-8",
            "pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pb-8",
            className
          )}
        >
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="grid gap-1.5">
              {eyebrow && (
                <p className="text-xs font-semibold tracking-(--fc-tracking-eyebrow) text-muted-foreground uppercase">
                  {eyebrow}
                </p>
              )}
              <DialogPrimitive.Title className="font-heading text-2xl font-semibold tracking-(--fc-tracking-heading) md:text-3xl">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-sm text-muted-foreground">{description}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-ink outline-none hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <X aria-hidden="true" className="size-5" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  )
}

const DialogClose = DialogPrimitive.Close

export { Dialog, DialogContent, DialogClose }
