import type * as React from "react"
import { Sidebar } from "@/components/shell/sidebar"
import { TabBar } from "@/components/shell/tab-bar"
import type { BellReminders } from "@/components/shell/bell"
import { Topbar } from "@/components/shell/topbar"

export type ShellUser = { name: string | null; email: string }

/**
 * App chrome: sidebar (≥ 761px), sticky topbar, bottom tab bar (≤ 760px).
 * `user` is null only while the signed-in user is loading (Suspense fallback).
 */
export function AppShell({
  user,
  reminders,
  children,
}: {
  user: ShellUser | null
  /** The bell's reminders, streamed (not awaited) so pages don't wait for them. */
  reminders?: BellReminders
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh md:pl-(--fc-layout-sidebar-width)">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Sidebar user={user} />
      <Topbar reminders={reminders} />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-(--fc-layout-content-max-width) px-4 pt-6 pb-[calc(var(--fc-layout-tab-bar-height)+2rem+env(safe-area-inset-bottom))] outline-none md:px-7 md:pt-6 md:pb-8"
      >
        {children}
      </main>
      <TabBar />
    </div>
  )
}

/** Page heading block: optional eyebrow, H1, subtitle, right-side actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 md:mb-6">
      <div className="grid gap-1">
        {eyebrow && (
          <p className="text-xs font-semibold tracking-(--fc-tracking-eyebrow) text-muted-foreground uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-(--fc-tracking-heading) md:text-3xl">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  )
}
