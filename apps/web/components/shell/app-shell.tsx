import type * as React from "react"
import { Sidebar } from "@/components/shell/sidebar"
import { TabBar } from "@/components/shell/tab-bar"
import { Topbar, type TopbarRoutes } from "@/components/shell/topbar"
import type { NavPreview } from "@/components/shell/nav-items"

export type ShellUser = { name: string | null; email: string }

/**
 * App chrome: sidebar (≥ 761px), sticky topbar, bottom tab bar (≤ 760px).
 * `user` is null only while the signed-in user is loading (Suspense fallback).
 */
export function AppShell({
  user,
  children,
  navPreview,
  topbarRoutes,
}: {
  user: ShellUser | null
  children: React.ReactNode
  /** Dev prototypes only (see navItems). */
  navPreview?: NavPreview
  topbarRoutes?: TopbarRoutes
}) {
  return (
    <div className="min-h-dvh md:pl-(--fc-layout-sidebar-width)">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Sidebar user={user} navPreview={navPreview} />
      <Topbar routes={topbarRoutes} />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-(--fc-layout-content-max-width) px-4 pt-6 pb-[calc(var(--fc-layout-tab-bar-height)+2rem+env(safe-area-inset-bottom))] outline-none md:px-8.5 md:pt-8 md:pb-10"
      >
        {children}
      </main>
      <TabBar navPreview={navPreview} />
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8">
      <div className="grid gap-2">
        {eyebrow && (
          <p className="text-xs font-semibold tracking-(--fc-tracking-eyebrow) text-muted-foreground uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-semibold tracking-(--fc-tracking-heading) md:text-4xl">{title}</h1>
        {description && <p className="text-base text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  )
}
