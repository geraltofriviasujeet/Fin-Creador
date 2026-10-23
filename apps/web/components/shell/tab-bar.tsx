"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "cn"
import { toast } from "@/components/ui/toast"
import { type NavPreview, comingSoonMessage, isActive, navItems } from "@/components/shell/nav-items"

const tabClasses =
  "flex h-full flex-1 flex-col items-center justify-center gap-1 rounded-lg text-xs [&_svg]:size-5"

/** Bottom tab bar at ≤ 760px (design-spec §5). */
export function TabBar({ navPreview }: { navPreview?: NavPreview }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex h-(--fc-layout-tab-bar-height) items-stretch px-1">
        {navItems(navPreview).filter((item) => item.inTabBar).map((item) => {
          const Icon = item.icon
          const label = item.tabLabel ?? item.label
          const active = item.available && isActive(item, pathname)
          return (
            <li key={item.key} className="flex flex-1">
              {item.available ? (
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
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
