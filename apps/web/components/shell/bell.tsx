"use client"

import { Suspense, use } from "react"
import Link from "next/link"
import { Popover } from "@base-ui/react/popover"
import { Bell as BellIcon } from "lucide-react"
import { type BellReminder, reminderText } from "@fin-creador/api"
import { cn } from "cn"
import { fullDate, money } from "@/components/transactions/display"
import { buttonVariants } from "@/components/ui/button"

// The bell (Sprint 8a): in-app reminders only, the same list as the "Due soon" card (EMIs
// overdue, due today or tomorrow, or planned for today or tomorrow). Email and push are a
// later notifications step. The dot shows only when something is due.

export type BellReminders = Promise<BellReminder[] | null>

export function Bell({ reminders }: { reminders?: BellReminders }) {
  return (
    <Suspense fallback={<BellButton count={0} items={null} />}>
      {reminders ? <LoadedBell reminders={reminders} /> : <BellButton count={0} items={null} />}
    </Suspense>
  )
}

function LoadedBell({ reminders }: { reminders: BellReminders }) {
  const items = use(reminders)
  return <BellButton count={items?.length ?? 0} items={items} />
}

function BellButton({ count, items }: { count: number; items: BellReminder[] | null }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={count > 0 ? `Notifications, ${count} due` : "Notifications"}
        className={cn(buttonVariants({ variant: "secondary", size: "icon" }), "relative")}
      >
        <BellIcon aria-hidden="true" className="size-5" />
        {count > 0 && <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-2 rounded-full bg-danger ring-2 ring-surface" />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-40">
          <Popover.Popup className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 text-ink shadow-(--shadow-raised) outline-none">
            <Popover.Title className="font-heading text-base font-semibold">Due soon</Popover.Title>
            {items === null ? (
              <p className="mt-2 text-sm text-muted-foreground">We couldn&apos;t load reminders. Reload to try again.</p>
            ) : items.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing due today or tomorrow.</p>
            ) : (
              <ul className="mt-1 grid">
                {items.map((r) => (
                  <li key={r.id} className="grid gap-0.5 border-b border-line py-2 last:border-b-0">
                    <p className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-semibold">{r.loanName}</span>
                      <span className="font-semibold tabular-nums">{money(r.amountMinor, r.currency)}</span>
                    </p>
                    <p className={cn("text-xs", r.reason === "overdue" ? "font-semibold text-danger" : "text-muted-foreground")}>
                      {r.label} · {reminderText(r)} · {fullDate(r.dueDate)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Popover.Close
              render={
                <Link href="/loans-liabilities" className="mt-2 inline-flex text-sm font-semibold text-ink underline underline-offset-4 hover:no-underline">
                  Open Loans &amp; liabilities
                </Link>
              }
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
