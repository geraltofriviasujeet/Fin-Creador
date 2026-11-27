"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { formatMoney } from "@fin-creador/domain"
import { Dialog, DialogContent } from "@/components/ui/dialog"

// The Money left card's "See all accounts": each account's balance today, Cash in hand
// included, from the same rows as Total available (summarizeHoldings). Nothing is calculated
// here; balances are exact, as on the Income page.

export type MoneyLeftRow = { id: string; label: string; kind: "bank" | "cash" | "other"; currency: string; balanceMinor: number; inTotal: boolean }

const KIND_LABEL: Record<MoneyLeftRow["kind"], string> = { bank: "Bank account", cash: "Cash in hand", other: "Other account" }

const exact = (minor: number, currency: string) => formatMoney(minor, { currency, trimZeroFraction: true })

export function MoneyLeftAccounts({ rows, totalMinor, currency }: { rows: MoneyLeftRow[]; totalMinor: number; currency: string }) {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) {
    return (
      <Link href="/income" className="flex items-center justify-between gap-2 underline-offset-4 hover:underline">
        <span>Add an account</span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
      </Link>
    )
  }
  const hasCash = rows.some((r) => r.kind === "cash")
  const counted = rows.filter((r) => r.inTotal)
  const other = rows.filter((r) => !r.inTotal)
  const row = (r: MoneyLeftRow) => (
    <li key={r.id} className="flex items-center justify-between gap-3 py-3">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{r.label}</span>
        <span className="block text-xs text-muted-foreground">{KIND_LABEL[r.kind]}</span>
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums">{exact(r.balanceMinor, r.currency)}</span>
    </li>
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-deep md:min-h-0"
      >
        <span>See all accounts ({rows.length})</span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent title="Money left" description="How much is in each account today.">
            <ul aria-label="Accounts in Money left" className="divide-y divide-line border-y border-line">
              {counted.map(row)}
              {!hasCash && (
                <li className="flex items-center justify-between gap-3 py-3 text-sm text-muted-foreground">
                  <span>No cash in hand recorded</span>
                  <Link href="/income" className="font-semibold text-success underline-offset-4 hover:underline">
                    Add cash
                  </Link>
                </li>
              )}
            </ul>
            <p className="mt-3 flex items-center justify-between gap-3 text-sm font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{exact(totalMinor, currency)}</span>
            </p>
            {other.length > 0 && (
              <>
                <p className="mt-5 text-xs text-muted-foreground">In other currencies, not in Money left (never converted):</p>
                <ul aria-label="Accounts in other currencies" className="divide-y divide-line">
                  {other.map(row)}
                </ul>
              </>
            )}
            <Link href="/income" className="mt-5 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-success underline-offset-4 hover:underline md:min-h-10">
              Manage accounts on Income
              <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
