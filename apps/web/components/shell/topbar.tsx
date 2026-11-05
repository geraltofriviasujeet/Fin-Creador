"use client"

import Link from "next/link"
import { Search, Settings } from "lucide-react"
import { Logo } from "@/components/brand/logo"
import { cn } from "cn"
import { buttonVariants } from "@/components/ui/button"
import { AddMenu } from "@/components/shell/add-menu"
import { Bell, type BellReminders } from "@/components/shell/bell"

/**
 * Sticky topbar (design-spec §4–5). "Add expense" (with a menu for income, transfer and
 * refund) opens the add dialog on Transactions, and search is a plain GET to it (?q=).
 * The bell lists in-app reminders (Sprint 8a: EMIs due soon); its dot shows only when
 * something is due.
 */

export function Topbar({ reminders }: { reminders?: BellReminders }) {
  return (
    <header className="sticky top-0 z-20 flex h-(--fc-layout-topbar-height) items-center gap-3 border-b border-line bg-surface/82 px-4 backdrop-blur-md md:px-7">
      <Logo tone="onLight" className="md:hidden" />

      <form
        role="search"
        action="/transactions"
        className="relative hidden w-(--fc-layout-search-width) max-w-full md:block"
      >
        <label htmlFor="global-search" className="sr-only">
          Search
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-subtle"
        />
        <input
          id="global-search"
          name="q"
          type="search"
          placeholder="Search…"
          className="h-[36px] w-full rounded-lg border border-line bg-canvas pr-3 pl-10 text-sm text-ink outline-none placeholder:text-muted-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        />
      </form>

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <Bell reminders={reminders} />
        {/* Navigation is a real link styled as a button, so it is announced as a link. */}
        <Link href="/settings" aria-label="Settings" className={cn(buttonVariants({ variant: "secondary", size: "icon" }), "md:hidden")}>
          <Settings aria-hidden="true" className="size-5" />
        </Link>
        <AddMenu />
      </div>
    </header>
  )
}
