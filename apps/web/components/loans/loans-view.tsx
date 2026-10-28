"use client"

import type * as React from "react"
import { useState, useTransition } from "react"
import { ChevronDown, Plus } from "lucide-react"
import { type DueItem, type LoanItem, type LoansView, type PaymentRecord, type ReminderEntry, newRequestKey } from "@fin-creador/api"
import { LOAN_TYPE_LABELS } from "@fin-creador/domain"
import { cn } from "cn"
import { deleteLoanAction, setLoanArchivedAction, voidDuePaymentAction } from "@/app/(app)/loans-liabilities/actions"
import { PageHeader } from "@/components/shell/app-shell"
import { fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { LOANS_HEADER, LoanBadgeChip, NOT_IN_TOTAL, ratePercent } from "./display"
import { ConfirmAction, run } from "./confirm"
import { type ShortTermOpen, ShortTermBox, ShortTermDialogs } from "@/components/cards/short-term"
import { DueSoonList, hasLiabilities } from "./due-soon"
import { AddLoanForm, EditLoanForm } from "./loan-form"
import { PayForm } from "./pay-form"

// The Loans & Liabilities page (Sprint 8a, 8b, web). Due soon at the top, then three boxes:
// Long-term liabilities (loans other than card EMIs, each with its detail and schedule;
// archived collapsed), Short-term & operational (cards, card EMIs, borrowing:
// components/cards) and Statutory & legal (8d), shown as coming next.

type Open =
  | { kind: "add" }
  | { kind: "edit" | "archive" | "delete"; loan: LoanItem }
  | { kind: "pay" | "plan"; item: DueItem }
  | { kind: "editPayment" | "void"; item: DueItem; payment: PaymentRecord }
  | null

/** Desktop columns: loan, outstanding, next EMI, status, expand. */
const COLUMNS = "md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_auto]"

const STATUS_TEXT: Record<DueItem["status"], string> = { pending: "Pending", paid: "Paid", before_tracking: "Before tracking" }

export function LoansPageView({ view }: { view: LoansView }) {
  const [open, setOpenLoan] = useState<Open>(null)
  const [shortOpen, setShortOpenState] = useState<ShortTermOpen | null>(null)
  // One dialog at a time, from either box.
  const setOpen = (o: Open) => {
    setShortOpenState(null)
    setOpenLoan(o)
  }
  const setShortOpen = (o: ShortTermOpen | null) => {
    setOpenLoan(null)
    setShortOpenState(o)
  }
  const longTerm = view.loans.filter((l) => l.loan.loanType !== "credit_card_emi")
  const shortTerm = view.shortTerm
  const onReminder = (r: ReminderEntry) => {
    if (r.loanItem) return setOpen({ kind: "pay", item: r.loanItem })
    const card = shortTerm?.cards.find((c) => c.card.id === r.cardId)
    if (card) return setShortOpen({ kind: r.reason === "statement" ? "statement" : "payCard", card })
    const borrowing = shortTerm?.borrowings.find((b) => b.borrowing.id === r.borrowingId)
    if (borrowing) setShortOpen({ kind: "repay", borrowing, due: borrowing.dues.find((d) => d.id === r.id) })
  }
  const [showArchived, setShowArchived] = useState(false)
  const [busy, startBusy] = useTransition()
  const close = () => {
    setOpenLoan(null)
    setShortOpenState(null)
  }
  const add = () => setOpen({ kind: "add" })
  const loanOf = (item: DueItem) => [...view.loans, ...view.archived].find((l) => l.loan.id === item.loanId)
  const currencyOf = (item: DueItem) => loanOf(item)?.loan.currency ?? view.currency

  const restore = (l: LoanItem) =>
    startBusy(async () => {
      const result = await run(() => setLoanArchivedAction({ loanId: l.loan.id, archived: false }))
      if (result.status === "success") toast.success(result.message)
      else toast.error(result.message)
    })

  return (
    <>
      <PageHeader {...LOANS_HEADER} />

      {hasLiabilities(view) && (
        <Card aria-labelledby="due-soon-title" className="mb-4 grid gap-1 py-3 md:py-3.5">
          <CardTitle id="due-soon-title">Due soon</CardTitle>
          {view.reminders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due today or tomorrow.</p>
          ) : (
            <DueSoonList reminders={view.reminders} onAction={onReminder} />
          )}
        </Card>
      )}

      <div className="grid gap-4">
        <Card role="region" aria-labelledby="long-term-title" className="px-0 py-0 md:px-0 md:py-0">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3.5 pb-2.5 md:px-5">
            <div className="grid gap-0.5">
              <h2 id="long-term-title" className="font-heading text-lg font-bold">
                Long-term liabilities
              </h2>
              <p className="text-xs text-muted-foreground tabular-nums">
                {longTerm.length > 0 && (
                  <>
                    Outstanding <span className="font-semibold text-ink">{money(view.longTermOutstandingMinor, view.currency)}</span> ·{" "}
                  </>
                )}
                {NOT_IN_TOTAL}
              </p>
            </div>
            <Button onClick={add}>
              <Plus aria-hidden="true" />
              Add loan
            </Button>
          </div>

          {longTerm.length === 0 ? (
            <div className="grid justify-items-start gap-1.5 border-t border-line px-4 py-3 md:px-5">
              <p className="text-sm font-semibold">No loans yet</p>
              <p className="text-sm text-muted-foreground">
                Add a home, vehicle, personal, education or other loan, or a credit card EMI. We estimate the EMI and schedule, and remind you when an EMI is due.
              </p>
            </div>
          ) : (
            <>
              <div aria-hidden="true" className={cn("hidden gap-3 border-y border-line px-5 py-2 text-xs font-semibold text-muted-foreground md:grid", COLUMNS)}>
                <span>Loan</span>
                <span className="text-right">Outstanding</span>
                <span className="text-right">Next EMI</span>
                <span className="text-right">Status</span>
                <span className="sr-only">Details</span>
              </div>
              <ul aria-label="Loans" className="border-t border-line md:border-t-0">
                {longTerm.map((l) => (
                  <LoanRow key={l.loan.id} item={l} today={view.today} onOpen={setOpen} />
                ))}
              </ul>
            </>
          )}

          {view.archived.length > 0 && (
            <div className="border-t border-line px-4 py-2 md:px-5">
              <Button variant="link" size="sm" aria-expanded={showArchived} onClick={() => setShowArchived((s) => !s)}>
                {showArchived ? "Hide" : "Show"} archived ({view.archived.length})
              </Button>
              {showArchived && (
                <ul aria-label="Archived loans" className="mt-1">
                  {view.archived.map((l) => (
                    <li key={l.loan.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0">
                      <div className="grid min-w-0 flex-1 basis-60 gap-0.5">
                        <p className="text-sm font-semibold">{l.name}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {l.typeLabel} · outstanding {money(l.outstandingMinor, l.loan.currency)}
                          {l.hasPayments && " · has payments, so it can't be deleted"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-0.5">
                        <Button variant="ghost" size="sm" disabled={busy} aria-label={`Restore ${l.name}`} onClick={() => restore(l)}>
                          Restore
                        </Button>
                        {!l.hasPayments && (
                          <Button variant="ghost" size="sm" className="text-danger" aria-label={`Delete ${l.name} permanently`} onClick={() => setOpen({ kind: "delete", loan: l })}>
                            Delete permanently
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        {shortTerm ? (
          <ShortTermBox
            view={shortTerm}
            currency={view.currency}
            onOpen={setShortOpen}
            renderLoan={(l) => (
              <LoanRow
                item={l}
                today={view.today}
                onOpen={setOpen}
                extra={
                  <Button variant="ghost" size="sm" aria-label={`Link ${l.name} to a card`} onClick={() => setShortOpen({ kind: "linkEmi", loan: l })}>
                    {l.loan.cardId ? "Change card" : "Link to card"}
                  </Button>
                }
              />
            )}
          />
        ) : (
          <ComingNext id="short-term" title="Short-term & operational liabilities">
            Credit card dues and EMIs, and informal borrowing from friends, family or others.
          </ComingNext>
        )}
        <ComingNext id="statutory" title="Statutory & legal liabilities">
          Income tax payable, fines and unpaid e-challans.
        </ComingNext>
      </div>

      <Dialog open={open !== null || shortOpen !== null} onOpenChange={(o) => !o && close()}>
        {shortOpen && shortTerm && <ShortTermDialogs open={shortOpen} view={shortTerm} accounts={view.accounts} today={view.today} currency={view.currency} onClose={close} />}
        {open?.kind === "add" && (
          <DialogContent
            eyebrow="Loans & Liabilities"
            title="Add loan"
            description="Use the figures on your loan statement or sanction letter."
            className="flex max-h-dvh flex-col md:max-h-[calc(100dvh-2rem)] md:max-w-[640px]"
          >
            <AddLoanForm today={view.today} currency={view.currency} onDone={close} />
          </DialogContent>
        )}
        {open?.kind === "edit" && (
          <DialogContent eyebrow="Loans & Liabilities" title={`Edit ${open.loan.name}`} description="Amounts taken, dates and tenure stay as entered." className="md:max-w-[640px]">
            <EditLoanForm item={open.loan} onDone={close} />
          </DialogContent>
        )}
        {(open?.kind === "pay" || open?.kind === "plan") && (
          <DialogContent
            eyebrow={open.item.loanName}
            title={`${open.item.label}, due ${fullDate(open.item.dueDate)}`}
            description={`Amount due ${money(open.item.split?.totalMinor ?? open.item.amountMinor, currencyOf(open.item))}.`}
          >
            <PayForm item={open.item} accounts={view.accounts} today={view.today} currency={currencyOf(open.item)} startMode={open.kind === "plan" ? "later" : "paid"} onDone={close} />
          </DialogContent>
        )}
        {open?.kind === "editPayment" && (
          <DialogContent eyebrow={open.item.loanName} title={`Edit payment for ${open.item.label}`} description="Every part of the payment changes together.">
            <PayForm item={open.item} payment={open.payment} accounts={view.accounts} today={view.today} currency={currencyOf(open.item)} onDone={close} />
          </DialogContent>
        )}
        {open?.kind === "void" && (
          <DialogContent
            eyebrow={open.item.loanName}
            title={`Void the payment for ${open.item.label}?`}
            description={`${money(open.item.amountMinor, currencyOf(open.item))} paid ${fullDate(open.payment.paidOn)}. Every entry it posted is voided and the EMI is pending again.`}
          >
            <VoidPayment payment={open.payment} onDone={close} />
          </DialogContent>
        )}
        {open?.kind === "archive" && (
          <DialogContent
            eyebrow="Loans & Liabilities"
            title={`Archive ${open.loan.name}?`}
            description="It moves to Archived: no reminders and no payments until you restore it. Its history stays."
          >
            <ConfirmAction label="Archive" pendingLabel="Archiving…" action={() => setLoanArchivedAction({ loanId: open.loan.loan.id, archived: true })} onDone={close} />
          </DialogContent>
        )}
        {open?.kind === "delete" && (
          <DialogContent
            eyebrow="Loans & Liabilities"
            title={`Delete ${open.loan.name} permanently?`}
            description="The loan and its schedule are removed for good. This can't be undone."
          >
            <ConfirmAction label="Delete permanently" pendingLabel="Deleting…" destructive action={() => deleteLoanAction({ loanId: open.loan.loan.id })} onDone={close} />
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

/** A box for a kind of liability that a later sprint adds (8b and 8d in docs/sprint-plan.md). */
function ComingNext({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card role="region" aria-labelledby={`${id}-title`} className="grid gap-1 py-3 md:py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${id}-title`} className="font-heading text-lg font-bold">
          {title}
        </h2>
        <Badge tone="neutral">Coming next</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </Card>
  )
}

function LoanRow({ item, today, onOpen, extra }: { item: LoanItem; today: string; onOpen: (open: Open) => void; extra?: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const { loan, next } = item
  const id = `loan-${loan.id}`
  const cell = "grid gap-0.5 md:block md:text-right"
  const cellLabel = "text-xs text-muted-foreground md:sr-only"
  const nextAmount = next ? (next.split?.totalMinor ?? next.amountMinor) : null
  return (
    <li className="border-b border-line last:border-b-0">
      <div className={cn("grid grid-cols-2 items-start gap-x-3 gap-y-2 px-4 py-2.5 md:items-center md:px-5", COLUMNS)}>
        <div className="col-span-2 min-w-0 md:col-span-1">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded((e) => !e)}
            className="-mx-1 flex max-w-full items-start gap-1 rounded-md px-1 text-left outline-none focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronDown aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{item.name}</span>
              <span className="block text-xs text-muted-foreground">
                {loan.nickname ? `${loan.lender} · ` : ""}
                {item.typeLabel}
              </span>
            </span>
          </button>
        </div>
        <div className={cell}>
          <span className={cellLabel}>Outstanding</span>
          <span className="text-sm font-semibold tabular-nums">{money(item.outstandingMinor, loan.currency)}</span>
        </div>
        <div className={cell}>
          <span className={cellLabel}>Next EMI</span>
          {next && nextAmount !== null ? (
            <>
              <span className="text-sm tabular-nums">{money(nextAmount, loan.currency)}</span>
              <span className="block text-xs text-muted-foreground tabular-nums">{fullDate(next.dueDate)}</span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </div>
        <div className={cn(cell, "md:flex md:justify-end")}>
          <span className={cellLabel}>Status</span>
          <LoanBadgeChip badge={item.badge} />
        </div>
        <div className="col-span-2 -mr-2 flex flex-wrap justify-end gap-0.5 md:col-span-1">
          {extra}
          {next && (
            <Button variant="secondary" size="sm" aria-label={`Pay ${next.label} of ${item.name}`} onClick={() => onOpen({ kind: "pay", item: next })}>
              Pay EMI
            </Button>
          )}
        </div>
      </div>
      {item.nextShortfall && (
        <p role="note" className="mx-4 mb-2 rounded-lg bg-chip-peach px-3 py-1.5 text-xs font-semibold text-danger md:mx-5">
          {item.nextShortfall}
        </p>
      )}
      {expanded && <LoanDetail id={id} item={item} today={today} onOpen={onOpen} />}
    </li>
  )
}

function LoanDetail({ id, item, today, onOpen }: { id: string; item: LoanItem; today: string; onOpen: (open: Open) => void }) {
  const [showSchedule, setShowSchedule] = useState(false)
  const { loan, next } = item
  const c = loan.currency
  const fact = "grid content-start gap-0.5"
  const label = "text-xs text-muted-foreground"
  const pending = item.items.filter((d) => d.status === "pending" && !d.notNeeded).length
  return (
    <div id={id} className="mx-4 mb-3 grid gap-3 rounded-xl bg-canvas px-3 py-3 md:mx-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
        <div className={fact}>
          <dt className={label}>{loan.loanType === "credit_card_emi" ? "Card issuer" : "Lender"}</dt>
          <dd className="font-semibold">{loan.lender}</dd>
        </div>
        <div className={fact}>
          <dt className={label}>Type</dt>
          <dd>{loan.loanType === "other" ? `${LOAN_TYPE_LABELS.other}: ${item.typeLabel}` : item.typeLabel}</dd>
        </div>
        <div className={fact}>
          <dt className={label}>Rate</dt>
          <dd className="tabular-nums">
            {ratePercent(loan.rateBps)} {loan.rateKind}
          </dd>
        </div>
        <div className={fact}>
          <dt className={label}>EMI</dt>
          <dd className="tabular-nums">
            {money(loan.emiMinor, c)}
            {loan.emiMinor !== loan.emiEstimateMinor && <span className="block text-xs text-muted-foreground">estimate {money(loan.emiEstimateMinor, c)}</span>}
          </dd>
        </div>
        <div className={fact}>
          <dt className={label}>Amount taken</dt>
          <dd className="tabular-nums">
            {money(loan.disbursedMinor, c)}
            <span className="block text-xs text-muted-foreground">of {money(loan.sanctionedMinor, c)} sanctioned</span>
          </dd>
        </div>
        <div className={fact}>
          <dt className={label}>Tenure</dt>
          <dd className="tabular-nums">
            {loan.tenureMonths} months
            <span className="block text-xs text-muted-foreground">{pending} EMIs left</span>
          </dd>
        </div>
        <div className={fact}>
          <dt className={label}>Repaid</dt>
          <dd className="tabular-nums">
            {money(item.progress.repaidMinor, c)}
            <span aria-hidden="true" className="mt-1 block h-1.5 w-full max-w-32 overflow-hidden rounded-full bg-line">
              <span className="block h-full rounded-full bg-brand-deep" style={{ width: `${item.progress.repaidBps / 100}%` }} />
            </span>
          </dd>
        </div>
        <div className={fact}>
          <dt className={label}>Tracking since</dt>
          <dd className="tabular-nums">{fullDate(loan.trackingStartedOn)}</dd>
        </div>
      </dl>
      {item.pendingCapitalisedMinor > 0 && (
        <p className="text-xs text-muted-foreground">Interest added when EMIs start (estimate {money(item.pendingCapitalisedMinor, c)}).</p>
      )}
      {next?.plannedOn && (
        <p className="text-xs text-muted-foreground">
          {next.label} planned for {fullDate(next.plannedOn)}
          {next.plannedAccountName && ` from ${next.plannedAccountName}`}.
        </p>
      )}
      <div className="-ml-2 flex flex-wrap gap-0.5">
        {next && (
          <Button variant="ghost" size="sm" aria-label={`Will pay ${next.label} of ${item.name} later`} onClick={() => onOpen({ kind: "plan", item: next })}>
            Will pay later
          </Button>
        )}
        <Button variant="ghost" size="sm" aria-label={`Edit ${item.name}`} onClick={() => onOpen({ kind: "edit", loan: item })}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" aria-label={`Archive ${item.name}`} onClick={() => onOpen({ kind: "archive", loan: item })}>
          Archive
        </Button>
        <Button variant="ghost" size="sm" aria-expanded={showSchedule} onClick={() => setShowSchedule((s) => !s)}>
          {showSchedule ? "Hide schedule" : `Show schedule (${item.items.length})`}
        </Button>
      </div>
      {showSchedule && <Schedule item={item} today={today} onOpen={onOpen} />}
    </div>
  )
}

function Schedule({ item, today, onOpen }: { item: LoanItem; today: string; onOpen: (open: Open) => void }) {
  const c = item.loan.currency
  const th = "px-2 py-1.5 text-right font-semibold first:pl-3 first:text-left last:pr-3"
  const td = "px-2 py-1.5 text-right tabular-nums first:pl-3 first:text-left last:pr-3"
  // Pay from the schedule: the next EMI and any overdue one (archived loans take no payments).
  const archived = item.loan.archivedAt !== null
  const isOpen = (d: DueItem) => d.status === "pending" && !d.notNeeded
  const payable = new Set(archived ? [] : item.items.filter((d) => isOpen(d) && (d.id === item.next?.id || d.dueDate < today)).map((d) => d.id))
  return (
    <div className="grid gap-1">
      <div className="max-h-[360px] overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">Schedule of {item.name}</caption>
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-xs text-muted-foreground">
              <th scope="col" className={th}>
                Instalment
              </th>
              <th scope="col" className={th}>
                Due
              </th>
              <th scope="col" className={th}>
                Amount
              </th>
              <th scope="col" className={th}>
                Principal
              </th>
              <th scope="col" className={th}>
                Interest
              </th>
              <th scope="col" className={th}>
                Status
              </th>
              <th scope="col" className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {item.items.map((d) => (
              <tr key={d.id} className="border-b border-line last:border-b-0">
                <th scope="row" className={cn(td, "font-semibold")}>
                  {d.label}
                </th>
                <td className={td}>{fullDate(d.dueDate)}</td>
                <td className={td}>{d.notNeeded ? "—" : money(d.amountMinor, c)}</td>
                <td className={td}>{d.principalMinor === null ? "—" : money(d.principalMinor, c)}</td>
                <td className={td}>{d.interestMinor === null ? "—" : money(d.interestMinor, c)}</td>
                <td className={td}>
                  {d.notNeeded ? (
                    <span className="text-xs text-muted-foreground">Not needed</span>
                  ) : d.status === "paid" ? (
                    <Badge tone="positive">Paid {d.payment && fullDate(d.payment.paidOn)}</Badge>
                  ) : isOpen(d) && d.dueDate < today ? (
                    <Badge tone="negative">Overdue</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">{STATUS_TEXT[d.status]}</span>
                  )}
                </td>
                <td className={cn(td, "whitespace-nowrap")}>
                  {d.payment && (
                    <>
                      <Button variant="ghost" size="sm" aria-label={`Edit payment for ${d.label}`} onClick={() => onOpen({ kind: "editPayment", item: d, payment: d.payment! })}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Void payment for ${d.label}`} onClick={() => onOpen({ kind: "void", item: d, payment: d.payment! })}>
                        Void
                      </Button>
                    </>
                  )}
                  {payable.has(d.id) && (
                    <Button variant="ghost" size="sm" aria-label={`Pay ${d.label}`} onClick={() => onOpen({ kind: "pay", item: d })}>
                      Pay
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Amounts not yet paid are estimates from what you owe now; your lender&apos;s figures can differ slightly.</p>
    </div>
  )
}

function VoidPayment({ payment, onDone }: { payment: PaymentRecord; onDone: () => void }) {
  const [requestKey] = useState(newRequestKey)
  const [reason, setReason] = useState("")
  return (
    <div className="grid gap-3">
      <TextField name="reason" label="Reason (optional)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoComplete="off" />
      <ConfirmAction
        label="Void payment"
        pendingLabel="Voiding…"
        destructive
        action={() => voidDuePaymentAction({ paymentId: payment.id, idempotencyKey: requestKey, reason: reason || undefined })}
        onDone={onDone}
      />
    </div>
  )
}

export function LoansSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading loans">
      <PageHeader {...LOANS_HEADER} />
      <Card className="grid gap-3">
        <span className="h-6 w-48 rounded bg-canvas" />
        <span className="h-4 w-72 rounded bg-canvas" />
      </Card>
      <Card className="mt-5 grid gap-3">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-10 w-full rounded-lg bg-canvas" />
        ))}
      </Card>
    </div>
  )
}
