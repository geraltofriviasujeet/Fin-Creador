"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Check } from "lucide-react"
import type { GettingStartedItems } from "@fin-creador/api"
import { cn } from "cn"
import { dismissGettingStartedAction } from "@/app/(app)/onboarding/actions"
import { UPI_IMPORT_HREF } from "@/components/statements/upi-links"
import { Card } from "@/components/ui/card"
import { toast } from "@/components/ui/toast"

// "Get started" on Overview (before Sprint 12a). Each item ticks itself from the person's own
// data (getting_started_status) and is a link to where you do it; ticked items stay, ticked.
// Nothing is written on render: the card goes only when the person taps Hide (top-right). It is
// never hidden automatically, so deleting an entry later can't bring it back.

const ITEMS = [
  { key: "account", label: "Add an account", href: "/income?add=bank" },
  { key: "expense", label: "Add your first expense", href: "/transactions?add=expense" },
  { key: "import", label: "Import a statement", href: UPI_IMPORT_HREF },
  { key: "roma", label: "Ask Roma a question", href: "/roma" },
] as const

export function GettingStartedCard({ items }: { items: GettingStartedItems }) {
  const [gone, setGone] = useState(false)
  const [pending, startTransition] = useTransition()
  const done = ITEMS.filter((i) => items[i.key]).length
  const allDone = done === ITEMS.length

  if (gone) return null

  const dismiss = () =>
    startTransition(async () => {
      const result = await dismissGettingStartedAction().catch(() => null)
      if (result?.ok) setGone(true)
      else toast.error("We couldn't save that. Check your connection and try again.")
    })

  return (
    <Card className="relative mb-4 grid gap-4" aria-labelledby="getting-started-heading" role="region">
      <button
        type="button"
        aria-label="Hide Get started"
        disabled={pending}
        onClick={dismiss}
        className="absolute top-3 right-3 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
      >
        Hide
      </button>
      <div className="pr-14">
        <div className="grid gap-1">
          <h2 id="getting-started-heading" className="text-lg font-semibold">
            {allDone ? "You're all set" : "Get started"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {allDone ? "You've tried the main parts of FinCreador." : `${done} of ${ITEMS.length} done. Each one ticks itself when you do it.`}
          </p>
        </div>
      </div>
      <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
        {ITEMS.map((item) => {
          const ticked = items[item.key]
          return (
            <li key={item.key} data-testid={`get-started-${item.key}`} data-done={ticked}>
              <Link
                href={item.href}
                className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm outline-none hover:bg-canvas focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border",
                    ticked ? "border-transparent bg-brand text-ink" : "border-line-strong bg-surface"
                  )}
                >
                  {ticked && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span className={cn(ticked && "text-muted-foreground line-through")}>{item.label}</span>
                <span className="sr-only">{ticked ? "(done)" : "(not done yet)"}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
