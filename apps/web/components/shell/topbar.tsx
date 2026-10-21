"use client"

import Link from "next/link"
import { Bell, Plus, Search, Settings } from "lucide-react"
import { Logo } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { comingSoonMessage } from "@/components/shell/nav-items"

/**
 * Sticky topbar (design-spec §4–5). Search, notifications and Add transaction belong to
 * Sprints 3 and 10; until then they explain that instead of pretending to work.
 * The bell shows an unread dot only when real unread notifications exist (none yet).
 */
export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-(--fc-layout-topbar-height) items-center gap-3 border-b border-line bg-surface/82 px-4 backdrop-blur-md md:px-8.5">
      <Logo tone="onLight" className="md:hidden" />

      <form
        role="search"
        className="relative hidden w-(--fc-layout-search-width) max-w-full md:block"
        onSubmit={(event) => {
          event.preventDefault()
          toast.info(comingSoonMessage("Transaction search"))
        }}
      >
        <label htmlFor="global-search" className="sr-only">
          Search transactions
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-subtle"
        />
        <input
          id="global-search"
          type="search"
          placeholder="Search transactions…"
          className="h-11 w-full rounded-lg border border-line bg-canvas pr-3 pl-10 text-sm text-ink outline-none placeholder:text-muted-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        />
      </form>

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Notifications"
          onClick={() => toast.info(comingSoonMessage("Notifications"))}
        >
          <Bell aria-hidden="true" className="size-5" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Settings"
          className="md:hidden"
          nativeButton={false}
          render={<Link href="/settings" />}
        >
          <Settings aria-hidden="true" className="size-5" />
        </Button>
        <Button
          size="icon"
          aria-label="Add transaction"
          className="md:hidden"
          onClick={() => toast.info(comingSoonMessage("Adding transactions"))}
        >
          <Plus aria-hidden="true" className="size-5" />
        </Button>
        <Button
          size="lg"
          className="hidden md:inline-flex"
          onClick={() => toast.info(comingSoonMessage("Adding transactions"))}
        >
          <Plus aria-hidden="true" />
          Add transaction
        </Button>
      </div>
    </header>
  )
}
