"use client"

import Link from "next/link"
import { Menu } from "@base-ui/react/menu"
import { ChevronDown, Plus } from "lucide-react"
import { cn } from "cn"
import { buttonVariants } from "@/components/ui/button"

// Topbar add actions: "Add expense" is the primary action (fast daily entry); the menu
// beside it holds the other three. Every one is a real link to the add dialog on Money in
// & out (?add=), so it works from any page and with the keyboard.

const href = (type: "expense" | "income" | "transfer" | "refund") => `/transactions?add=${type}`

const MORE = [
  { type: "income", label: "Add income" },
  { type: "transfer", label: "Transfer" },
  { type: "refund", label: "Refund" },
] as const

export function AddMenu() {
  return (
    <div className="flex items-center">
      <Link
        href={href("expense")}
        aria-label="Add expense"
        className={cn(buttonVariants({ size: "icon" }), "rounded-r-none md:hidden")}
      >
        <Plus aria-hidden="true" className="size-5" />
      </Link>
      <Link href={href("expense")} className={cn(buttonVariants({ size: "lg" }), "hidden rounded-r-none md:inline-flex")}>
        <Plus aria-hidden="true" />
        Add expense
      </Link>
      <Menu.Root>
        <Menu.Trigger
          aria-label="More ways to add"
          className={cn(
            buttonVariants({ size: "icon" }),
            "w-9 rounded-l-none border-l-primary-foreground/25 md:h-[40px]"
          )}
        >
          <ChevronDown aria-hidden="true" className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={6} className="z-50">
            <Menu.Popup className="min-w-44 rounded-xl border border-line bg-surface p-1 text-sm text-ink shadow-(--shadow-raised) outline-none">
              {MORE.map((m) => (
                <Menu.LinkItem
                  key={m.type}
                  render={<Link href={href(m.type)} />}
                  className="flex h-11 cursor-default items-center rounded-lg px-3 outline-none data-[highlighted]:bg-canvas"
                >
                  {m.label}
                </Menu.LinkItem>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}
