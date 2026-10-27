import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { type DueItem, type LoansView, reminderText } from "@fin-creador/api"
import type { Reminder } from "@fin-creador/domain"
import { fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
import { LOANS_PATH } from "./display"

// "Due soon" (Sprint 8a): EMIs overdue, due today or tomorrow, or planned for today or
// tomorrow, from stored dates (packages/domain/src/due-items.ts). On the Loans page each
// row has Pay; on the Overview it links to the page.

const amountOf = (item: DueItem) => item.split?.totalMinor ?? item.amountMinor

export function DueSoonList({ reminders, currency, onPay }: { reminders: Reminder<DueItem>[]; currency: string; onPay?: (item: DueItem) => void }) {
  return (
    <ul className="grid">
      {reminders.map(({ item, reason, daysOverdue }) => (
        <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0">
          <div className="grid min-w-0 flex-1 basis-48 gap-0.5">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <span className="truncate font-semibold">{item.loanName}</span>
              <Badge tone={reason === "overdue" ? "negative" : "info"}>{reminderText({ reason, daysOverdue })}</Badge>
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {item.label} · due {fullDate(item.dueDate)}
              {item.plannedOn && ` · planned ${fullDate(item.plannedOn)}${item.plannedAccountName ? ` from ${item.plannedAccountName}` : ""}`}
            </p>
          </div>
          <span className="text-sm font-semibold tabular-nums">{money(amountOf(item), currency)}</span>
          {onPay && (
            <Button variant="secondary" size="sm" aria-label={`Pay ${item.label} of ${item.loanName}`} onClick={() => onPay(item)}>
              Pay
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** The Overview card: shown once the person has a loan. */
export function DueSoonOverviewCard({ view }: { view: LoansView | null }) {
  if (!view || view.loans.length === 0) return null
  return (
    <Card aria-labelledby="due-soon-title" className="grid content-start gap-2">
      <CardTitle id="due-soon-title">Due soon</CardTitle>
      {view.dueSoon.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing due today or tomorrow.</p>
      ) : (
        <DueSoonList reminders={view.dueSoon} currency={view.currency} />
      )}
      <Link href={LOANS_PATH} className="inline-flex items-center gap-1 text-sm font-semibold text-ink underline-offset-4 hover:underline">
        {view.dueSoon.length === 0 ? "View loans" : "Pay from Loans & liabilities"}
        <ChevronRight aria-hidden="true" className="size-4" />
      </Link>
    </Card>
  )
}
