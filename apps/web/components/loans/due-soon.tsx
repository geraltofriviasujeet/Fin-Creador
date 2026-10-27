import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { type LoansView, type ReminderEntry, reminderText } from "@fin-creador/api"
import { fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
import { LOANS_PATH } from "./display"

// "Due soon" (Sprint 8a, 8b): loan EMIs, card bills and borrowing due dates overdue, due today
// or tomorrow, or planned for today or tomorrow, and card statements to add; from stored dates
// (packages/domain/src/due-items.ts, cards.ts). On the Loans page each row has its action; on
// the Overview it links to the page.

const ACTION: Record<ReminderEntry["source"], string> = { loan: "Pay", card: "Pay", borrowing: "Repay" }

export function DueSoonList({ reminders, onAction }: { reminders: ReminderEntry[]; onAction?: (entry: ReminderEntry) => void }) {
  return (
    <ul className="grid">
      {reminders.map((r) => {
        const action = r.reason === "statement" ? "Enter statement" : ACTION[r.source]
        const name = r.reason === "statement" ? `Enter the ${r.name} statement` : `${action} ${r.label} of ${r.name}`
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0">
            <div className="grid min-w-0 flex-1 basis-48 gap-0.5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <span className="truncate font-semibold">{r.name}</span>
                <Badge tone={r.reason === "overdue" ? "negative" : "info"}>{reminderText(r)}</Badge>
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {r.label}
                {r.dueDate && ` · due ${fullDate(r.dueDate)}`}
                {r.plannedOn && ` · planned ${fullDate(r.plannedOn)}${r.plannedAccountName ? ` from ${r.plannedAccountName}` : ""}`}
              </p>
            </div>
            {r.amountMinor !== null && <span className="text-sm font-semibold tabular-nums">{money(r.amountMinor, r.currency)}</span>}
            {onAction && (
              <Button variant="secondary" size="sm" aria-label={name} onClick={() => onAction(r)}>
                {action}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Whether the person has anything on Loans & Liabilities (the Due soon cards show then). */
export function hasLiabilities(view: LoansView): boolean {
  const s = view.shortTerm
  return view.loans.length > 0 || (s !== null && (s.cards.length > 0 || s.borrowings.length > 0))
}

/** The Overview card: shown once the person has a loan, card or borrowing. */
export function DueSoonOverviewCard({ view }: { view: LoansView | null }) {
  if (!view || !hasLiabilities(view)) return null
  return (
    <Card aria-labelledby="due-soon-title" className="grid content-start gap-2">
      <CardTitle id="due-soon-title">Due soon</CardTitle>
      {view.reminders.length === 0 ? <p className="text-sm text-muted-foreground">Nothing due today or tomorrow.</p> : <DueSoonList reminders={view.reminders} />}
      <Link href={LOANS_PATH} className="inline-flex items-center gap-1 text-sm font-semibold text-ink underline-offset-4 hover:underline">
        {view.reminders.length === 0 ? "View loans and cards" : "Pay from Loans & Liabilities"}
        <ChevronRight aria-hidden="true" className="size-4" />
      </Link>
    </Card>
  )
}
