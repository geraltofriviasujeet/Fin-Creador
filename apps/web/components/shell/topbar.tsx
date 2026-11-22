"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Search, Settings, X } from "lucide-react"
import { Logo } from "@/components/brand/logo"
import { cn } from "cn"
import { buttonVariants } from "@/components/ui/button"
import { AddMenu } from "@/components/shell/add-menu"
import { Bell, type BellReminders } from "@/components/shell/bell"
import { WebsiteLink } from "@/components/shell/website-link"

/**
 * Sticky topbar (design-spec §4–5). "Add expense" (with a menu for income, transfer and
 * refund) opens the add dialog on Transactions, and search is a plain GET to it (?q=).
 * The bell lists in-app reminders (Sprint 8a: EMIs due soon); its dot shows only when
 * something is due. The globe links to the FinCreador website (in "More" on phones).
 * Below md the search field is behind a search icon; it opens over the topbar (12a-2).
 */

export function Topbar({ reminders }: { reminders?: BellReminders }) {
  const [searching, setSearching] = useState(false)
  const pathname = usePathname()
  // A search (or any navigation) closes the phone search field.
  const [shownOn, setShownOn] = useState(pathname)
  if (shownOn !== pathname) {
    setShownOn(pathname)
    setSearching(false)
  }
  return (
    <header className="sticky top-0 z-20 flex h-(--fc-layout-topbar-height) items-center gap-3 border-b border-line bg-surface/82 px-4 backdrop-blur-md max-md:gap-2 md:px-7">
      <Logo tone="onLight" className="md:hidden" markOnlyOnSmallPhones />

      <form
        role="search"
        action="/transactions"
        className="relative hidden w-(--fc-layout-search-width) max-w-full md:block"
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
          name="q"
          type="search"
          placeholder="Search transactions…"
          className="h-[44px] w-full rounded-lg border border-line bg-canvas pr-3 pl-10 text-[16px] text-ink md:h-[36px] md:text-sm outline-none placeholder:text-muted-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        />
      </form>

      {searching && <PhoneSearch onClose={() => setSearching(false)} />}

      <div className="ml-auto flex items-center gap-1 md:gap-3">
        <button
          type="button"
          aria-label="Search transactions"
          aria-expanded={searching}
          aria-controls="phone-search"
          onClick={() => setSearching(true)}
          className={cn(buttonVariants({ variant: "secondary", size: "icon" }), "md:hidden")}
        >
          <Search aria-hidden="true" className="size-5" />
        </button>
        <WebsiteLink />
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

/** Phone search: the topbar's field, over the topbar, focused when it opens; Escape or × closes it. */
function PhoneSearch({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  return (
    <form
      id="phone-search"
      role="search"
      action="/transactions"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="absolute inset-0 z-10 flex items-center gap-2 bg-surface px-4 md:hidden"
    >
      <label htmlFor="phone-search-q" className="sr-only">
        Search transactions
      </label>
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-subtle" />
        <input
          ref={input}
          id="phone-search-q"
          name="q"
          type="search"
          enterKeyHint="search"
          placeholder="Search transactions…"
          className="h-[44px] w-full rounded-lg border border-line bg-canvas pr-3 pl-10 text-[16px] text-ink outline-none placeholder:text-muted-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        />
      </div>
      <button type="button" aria-label="Close search" onClick={onClose} className={buttonVariants({ variant: "ghost", size: "icon" })}>
        <X aria-hidden="true" className="size-5" />
      </button>
    </form>
  )
}
