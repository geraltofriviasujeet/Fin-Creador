"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Ellipsis } from "lucide-react"
import { cn } from "cn"
import { toast } from "@/components/ui/toast"
import { NAV_ITEMS, type NavItem, comingSoonMessage, isActive } from "@/components/shell/nav-items"

const tabClasses =
  "flex h-full flex-1 flex-col items-center justify-center gap-1 rounded-lg text-xs [&_svg]:size-5"

const MORE_ITEMS = NAV_ITEMS.filter((item) => !item.inTabBar && item.available)

/** Bottom tab bar at ≤ 760px (design-spec §5): four tabs and "More" for the rest. */
export function TabBar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex h-(--fc-layout-tab-bar-height) items-stretch px-1">
        {NAV_ITEMS.filter((item) => item.inTabBar).map((item) => (
          <li key={item.key} className="flex flex-1">
            <Tab item={item} pathname={pathname} />
          </li>
        ))}
        {MORE_ITEMS.length > 0 && (
          <li className="flex flex-1">
            <MoreMenu pathname={pathname} />
          </li>
        )}
      </ul>
    </nav>
  )
}

function Tab({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon
  const label = item.tabLabel ?? item.label
  const active = item.available && isActive(item, pathname)
  return item.available ? (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(tabClasses, active ? "font-bold text-ink" : "text-muted-foreground")}
    >
      <Icon aria-hidden="true" strokeWidth={active ? 2.25 : 1.75} />
      {label}
    </Link>
  ) : (
    <button
      type="button"
      aria-disabled="true"
      onClick={() => toast.info(comingSoonMessage(item.label))}
      className={cn(tabClasses, "text-muted-foreground")}
    >
      <Icon aria-hidden="true" strokeWidth={1.75} />
      {label}
      <span className="sr-only">(coming soon)</span>
    </button>
  )
}

/** A disclosure above the tab bar: closes on Escape (focus back to "More"), outside taps and navigation. */
function MoreMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false)
  const [openedOn, setOpenedOn] = useState(pathname)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const current = MORE_ITEMS.some((item) => isActive(item, pathname))
  // Navigating closes it.
  if (open && openedOn !== pathname) setOpen(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      setOpen(false)
      button.current?.focus()
    }
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer)
    }
  }, [open])

  return (
    <div ref={root} className="flex flex-1">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="tab-bar-more"
        onClick={() => {
          setOpenedOn(pathname)
          setOpen((o) => !o)
        }}
        className={cn(tabClasses, current || open ? "font-bold text-ink" : "text-muted-foreground")}
      >
        <Ellipsis aria-hidden="true" strokeWidth={current ? 2.25 : 1.75} />
        More
      </button>
      <ul
        id="tab-bar-more"
        hidden={!open}
        className="absolute right-2 bottom-[calc(100%+0.5rem)] grid w-56 gap-0.5 rounded-2xl border border-line bg-surface p-1.5 shadow-(--shadow-raised)"
      >
        {MORE_ITEMS.map((item) => {
          const Icon = item.icon
          const active = isActive(item, pathname)
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm [&_svg]:size-5",
                  active ? "bg-brand font-bold text-ink" : "text-ink hover:bg-canvas"
                )}
              >
                <Icon aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
