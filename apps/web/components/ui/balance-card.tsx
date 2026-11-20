"use client"

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react"
import { type BalanceChange, balanceDirection, formatBalance, formatBalanceChange } from "@fin-creador/domain"
import { cn } from "cn"
import { useCountUp } from "@/components/ui/count-up"

/** The count starts a moment after the card appears, so the eye catches it first. */
export const COUNT_DELAY_MS = 300

// The visible part of the balance card shown after a save (toast type "balance"). Screen readers
// skip it: the toast's title is the one line they hear ("Saved. HDFC Bank balance now ₹51,800.").
// Figures come from the server (WriteResult.balances); only the frames of the count are made here.

export function BalanceCardBody({ message, changes }: { message: string; changes: BalanceChange[] }) {
  return (
    <div aria-hidden="true" className="grid min-w-0 flex-1 gap-2" data-testid="balance-card">
      <p className="text-sm font-semibold">{message}</p>
      <ul className="grid gap-1.5">
        {changes.map((c) => (
          <BalanceRow key={c.accountId} change={c} />
        ))}
      </ul>
    </div>
  )
}

function BalanceRow({ change }: { change: BalanceChange }) {
  const shown = useCountUp(change.beforeMinor, change.afterMinor, undefined, COUNT_DELAY_MS)
  const direction = balanceDirection(change)
  const Icon = direction === "down" ? ArrowDownRight : ArrowUpRight
  return (
    <li className="grid gap-0.5" data-testid="balance-row" data-account={change.label}>
      <span className="flex items-center justify-between gap-2 text-xs text-nav-muted">
        <span className="truncate">{change.label}</span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold tabular-nums",
            direction === "up" ? "bg-brand text-ink" : "bg-white/10 text-nav-text"
          )}
          data-testid="balance-change"
        >
          <Icon aria-hidden="true" className="size-3.5" />
          {formatBalanceChange(change)}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-sm tabular-nums">
        <span className="text-nav-muted" data-testid="balance-before">
          {formatBalance(change.beforeMinor, change.currency)}
        </span>
        <ArrowRight aria-hidden="true" className="size-3.5 text-nav-muted" />
        <span className="font-heading text-base font-semibold" data-testid="balance-after" data-final={formatBalance(change.afterMinor, change.currency)}>
          {formatBalance(shown, change.currency)}
        </span>
      </span>
    </li>
  )
}
