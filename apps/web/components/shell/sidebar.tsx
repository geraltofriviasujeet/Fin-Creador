"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOut, Settings } from "lucide-react"
import { signOutAction } from "@/app/(auth)/actions"
import { cn } from "cn"
import { Logo } from "@/components/brand/logo"
import { toast } from "@/components/ui/toast"
import { type NavPreview, comingSoonMessage, isActive, navItems } from "@/components/shell/nav-items"
import type { ShellUser } from "@/components/shell/app-shell"

const itemClasses =
  "flex h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-base transition-colors [&_svg]:size-5 [&_svg]:shrink-0"

/** Fixed dark sidebar, shown at ≥ 761px (design-spec §4). */
export function Sidebar({ user, navPreview }: { user: ShellUser | null; navPreview?: NavPreview }) {
  const pathname = usePathname()

  return (
    <aside className="on-dark fixed inset-y-0 left-0 z-30 hidden w-(--fc-layout-sidebar-width) flex-col bg-nav px-4 pt-7 pb-5 text-nav-text md:flex">
      <Logo tone="onDark" className="ml-1.5" />

      <nav aria-label="Main" className="mt-10 flex-1">
        <ul className="grid gap-1.5">
          {navItems(navPreview).map((item) => {
            const Icon = item.icon
            const active = item.available && isActive(item, pathname)
            return (
              <li key={item.key}>
                {item.available ? (
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      itemClasses,
                      active ? "bg-brand font-bold text-ink" : "text-nav-muted hover:bg-white/5 hover:text-nav-text"
                    )}
                  >
                    <Icon aria-hidden="true" />
                    {item.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    aria-disabled="true"
                    onClick={() => toast.info(comingSoonMessage(item.label))}
                    className={cn(itemClasses, "text-nav-muted hover:bg-white/5")}
                  >
                    <Icon aria-hidden="true" />
                    {item.label}
                    <span className="ml-auto rounded-md bg-white/10 px-1.5 py-0.5 text-xs font-medium text-nav-muted">
                      Soon
                    </span>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="grid grid-cols-1 gap-4 border-t border-white/10 pt-4">
        <Link
          href="/settings"
          aria-current={isActive({ href: "/settings" }, pathname) ? "page" : undefined}
          className={cn(
            itemClasses,
            isActive({ href: "/settings" }, pathname)
              ? "bg-brand font-bold text-ink"
              : "text-nav-muted hover:bg-white/5 hover:text-nav-text"
          )}
        >
          <Settings aria-hidden="true" />
          Settings
        </Link>

        <div className="border-t border-white/10 pt-4">
          {user ? (
            <div className="flex items-center gap-3 px-1">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-chip-peach text-sm font-bold text-ink"
              >
                {user.name ? initials(user.name) : user.email.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user.name ?? user.email}</p>
                {user.name && <p className="truncate text-xs text-nav-muted">{user.email}</p>}
              </div>
              <form action={signOutAction} className="shrink-0">
                <button
                  type="submit"
                  aria-label="Sign out"
                  title="Sign out"
                  className="flex size-10 items-center justify-center rounded-lg text-nav-muted hover:bg-white/5 hover:text-nav-text"
                >
                  <LogOut aria-hidden="true" className="size-5" />
                </button>
              </form>
            </div>
          ) : (
            // Loading placeholder while the signed-in user is fetched.
            <div aria-hidden="true" className="flex items-center gap-3 px-1">
              <span className="size-10 shrink-0 rounded-full bg-white/10" />
              <span className="h-3 w-32 rounded bg-white/10" />
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}
