"use client"

import type * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { cn } from "cn"
import { useVisualViewportVars } from "@/lib/use-visual-viewport"

// Modal dialog (design-spec §6 and §9): eyebrow, title, close button, surface card with
// the raised shadow. Base UI traps focus, closes on Escape and restores focus on close.
// Animations are skipped under prefers-reduced-motion (globals.css).
//
// Below md (phones) the dialog is a bottom sheet sized to the visual viewport, so the
// on-screen keyboard never covers it: the header stays put, the body scrolls inside the
// sheet (Base UI's modal locks the page behind), and action rows marked SHEET_ACTIONS stick
// to the bottom of the sheet. Every phone class is max-md:, and the body wrapper is
// md:contents, so from md up the dialog renders exactly as before.

/** Sticky action row on phones (Save above the keyboard); no effect from md up. */
const SHEET_ACTIONS =
  "max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-1 max-md:border-t max-md:border-line max-md:bg-surface max-md:px-1 max-md:pt-3"

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />
}

function DialogContent({
  eyebrow,
  title,
  description,
  children,
  className,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
  /** Buttons beside the close button (a plan's Save as PDF). */
  actions?: React.ReactNode
}) {
  useVisualViewportVars()
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-ink/40 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <DialogPrimitive.Viewport className="fixed inset-0 z-50 grid items-end justify-items-center overflow-y-auto p-0 max-md:bottom-auto max-md:top-[var(--fc-vv-top,0px)] max-md:h-[var(--fc-vvh,100dvh)] max-md:overflow-hidden md:items-center md:p-4">
        <DialogPrimitive.Popup
          className={cn(
            "relative w-full max-w-xl rounded-t-3xl bg-surface p-5 text-ink shadow-(--shadow-raised) outline-none transition-[opacity,transform] duration-150 data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 md:rounded-3xl md:p-6",
            "pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-6",
            "max-md:flex max-md:max-h-[calc(var(--fc-vvh,100dvh)-env(safe-area-inset-top))] max-md:flex-col",
            className
          )}
        >
          <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
            <div className="grid gap-1.5">
              {eyebrow && (
                <p className="text-xs font-semibold tracking-(--fc-tracking-eyebrow) text-muted-foreground uppercase">
                  {eyebrow}
                </p>
              )}
              <DialogPrimitive.Title className="font-heading text-xl font-semibold tracking-(--fc-tracking-heading) md:text-2xl">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-sm text-muted-foreground">{description}</DialogPrimitive.Description>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              <DialogPrimitive.Close
                aria-label="Close"
                className="flex size-[44px] shrink-0 md:size-[36px] items-center justify-center rounded-lg border border-line bg-surface text-ink outline-none hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <X aria-hidden="true" className="size-5" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <div data-sheet-body="" className="max-md:-mx-1 max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:overflow-y-auto max-md:overscroll-contain max-md:px-1 md:contents">
            {children}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  )
}

const DialogClose = DialogPrimitive.Close

export { Dialog, DialogContent, DialogClose, SHEET_ACTIONS }
