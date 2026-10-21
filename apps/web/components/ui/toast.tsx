"use client"

import type * as React from "react"
import { Toast } from "@base-ui/react/toast"
import { Check, CircleAlert, Info, X } from "lucide-react"
import { cn } from "cn"

type ToastType = "success" | "info" | "error"

const toastManager = Toast.createToastManager()

function add(type: ToastType, title: string, description?: string) {
  return toastManager.add({
    type,
    title,
    description,
    // Errors are announced immediately; other toasts wait for the screen reader to be idle.
    priority: type === "error" ? "high" : "low",
  })
}

/** Show a toast from anywhere in client code. */
export const toast = {
  success: (title: string, description?: string) => add("success", title, description),
  info: (title: string, description?: string) => add("info", title, description),
  error: (title: string, description?: string) => add("error", title, description),
}

const icons: Record<ToastType, React.ReactNode> = {
  success: (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-ink">
      <Check aria-hidden="true" className="size-4" strokeWidth={3} />
    </span>
  ),
  info: <Info aria-hidden="true" className="size-5 shrink-0 text-nav-muted" />,
  error: <CircleAlert aria-hidden="true" className="size-5 shrink-0 text-danger-fill" />,
}

function ToastList() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((t) => (
    <Toast.Root
      key={t.id}
      toast={t}
      className={cn(
        "on-dark pointer-events-auto w-full rounded-xl bg-nav text-nav-text shadow-raised",
        "transition-[opacity,transform] duration-200 ease-out",
        "data-starting-style:translate-y-2 data-starting-style:opacity-0",
        "data-ending-style:translate-y-2 data-ending-style:opacity-0"
      )}
    >
      <Toast.Content className="flex items-center gap-3 p-3.5 pr-2.5">
        {icons[(t.type as ToastType | undefined) ?? "info"]}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <Toast.Title className="text-sm font-semibold" />
          <Toast.Description className="text-xs text-nav-muted" />
        </div>
        <Toast.Close
          aria-label="Dismiss notification"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-nav-muted hover:bg-white/10 hover:text-nav-text focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X aria-hidden="true" className="size-4" />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ))
}

/** Wrap the app once (root layout). Toasts sit above the mobile tab bar. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={toastManager}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="pointer-events-none fixed right-4 bottom-[calc(var(--fc-layout-tab-bar-height)+1rem+env(safe-area-inset-bottom))] left-4 z-50 flex flex-col gap-2 md:right-6 md:bottom-6 md:left-auto md:w-90">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}
