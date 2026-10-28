"use client"

import type * as React from "react"
import { Fragment, useState, useTransition } from "react"
import { ChevronDown, Plus } from "lucide-react"
import {
  BORROWING_BADGE_LABEL,
  type BorrowingDue,
  type BorrowingItem,
  type CardItem,
  type LiabilityPaymentLine,
  type LoanItem,
  type ShortTermView,
  cardBadgeText,
  newRequestKey,
} from "@fin-creador/api"
import { BORROWING_RELATIONSHIP_OPTIONS, type PayingAccount } from "@fin-creador/schemas"
import { cn } from "cn"
import {
  deleteBorrowingAction,
  deleteCardAction,
  deleteStatementAction,
  setBorrowingArchivedAction,
  setCardArchivedAction,
  voidDuePaymentAction,
  voidLiabilityPaymentAction,
} from "@/app/(app)/loans-liabilities/actions"
import { Meter } from "@/components/goals/display"
import { ConfirmAction, run } from "@/components/loans/confirm"
import { fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DialogContent } from "@/components/ui/dialog"
import { TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import {
  BorrowingDetailsForm,
  BorrowingForm,
  CardForm,
  CardPayForm,
  LinkEmiForm,
  PlanBillForm,
  PlanBorrowingDueForm,
  RepayForm,
  ReturnPlanForm,
  StatementForm,
  TALL_DIALOG,
} from "./forms"

// The "Short-term & operational liabilities" box (Sprint 8b, web): credit cards (owed, limit
// used, latest bill), card EMIs (loans, with Link to card) and money borrowed from people.
// Figures come from packages/api/src/cards/view.ts. Names only: never card or account digits.

export type ShortTermOpen =
  | { kind: "addCard" | "addBorrowing" }
  | { kind: "editCard" | "archiveCard" | "deleteCard" | "statement" | "payCard" | "planBill"; card: CardItem }
  | { kind: "editCardPayment" | "voidCardPayment"; card: CardItem; payment: LiabilityPaymentLine }
  | { kind: "deleteStatement"; card: CardItem; statementId: string; statementDate: string }
  | { kind: "returnPlan" | "details" | "archiveBorrowing" | "deleteBorrowing"; borrowing: BorrowingItem }
  /** Repay any amount, or one instalment (`due`), prefilled from it. */
  | { kind: "repay"; borrowing: BorrowingItem; due?: BorrowingDue }
  | { kind: "planBorrowingDue"; borrowing: BorrowingItem; due: BorrowingDue }
  | { kind: "editRepayment" | "voidRepayment"; borrowing: BorrowingItem; payment: LiabilityPaymentLine }
  | { kind: "linkEmi"; loan: LoanItem }

const NOT_IN_TOTAL = "Not in Total available"

const CARD_TONE: Record<CardItem["badge"], "positive" | "negative" | "info" | "neutral"> = {
  no_bill: "neutral",
  due: "info",
  overdue: "negative",
  paid: "positive",
  minimum_paid: "info",
  part_paid: "info",
}

const BORROWING_TONE: Record<BorrowingItem["badge"], "positive" | "negative" | "info" | "neutral"> = { repaid: "positive", due: "info", overdue: "negative", owed: "neutral" }

const label = "text-xs text-muted-foreground"

export function ShortTermBox({
  view,
  currency,
  onOpen,
  renderLoan,
}: {
  view: ShortTermView
  currency: string
  onOpen: (open: ShortTermOpen) => void
  /** A card EMI row (the loan row of Long-term), with its Link to card action. */
  renderLoan: (loan: LoanItem) => React.ReactNode
}) {
  const [showArchived, setShowArchived] = useState(false)
  const [busy, startBusy] = useTransition()
  const empty = view.cards.length === 0 && view.borrowings.length === 0 && view.cardEmis.length === 0
  const restore = (save: () => Promise<{ status: "success" | "error"; message: string }>) =>
    startBusy(async () => {
      const result = await run(save)
      if (result.status === "success") toast.success(result.message)
      else toast.error(result.message)
    })
  const archivedCount = view.archivedCards.length + view.archivedBorrowings.length
  return (
    <Card role="region" aria-labelledby="short-term-title" className="px-0 py-0 md:px-0 md:py-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3.5 pb-2.5 md:px-5">
        <div className="grid gap-0.5">
          <h2 id="short-term-title" className="font-heading text-lg font-bold">
            Short-term &amp; operational liabilities
          </h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            {!empty && (
              <>
                Owed <span className="font-semibold text-ink">{money(view.totalOwedMinor, currency)}</span> ·{" "}
              </>
            )}
            {NOT_IN_TOTAL}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onOpen({ kind: "addBorrowing" })}>
            <Plus aria-hidden="true" />
            Add borrowing
          </Button>
          <Button onClick={() => onOpen({ kind: "addCard" })}>
            <Plus aria-hidden="true" />
            Add card
          </Button>
        </div>
      </div>

      {empty ? (
        <div className="grid justify-items-start gap-1.5 border-t border-line px-4 py-3 md:px-5">
          <p className="text-sm font-semibold">No cards or borrowing yet</p>
          <p className="text-sm text-muted-foreground">
            Add a credit card to track what you owe, its bills and limit, or money you borrowed from friends, family or others. Card EMIs you add as loans show here too.
          </p>
        </div>
      ) : (
        <div className="border-t border-line">
          {view.cards.length > 0 && (
            <Section title="Credit cards">
              {view.cards.map((c) => (
                <CardRow key={c.card.id} item={c} onOpen={onOpen} />
              ))}
            </Section>
          )}
          {view.cardEmis.length > 0 && (
            <Section title="Card EMIs">
              {view.cardEmis.map((l) => (
                <Fragment key={l.loan.id}>{renderLoan(l)}</Fragment>
              ))}
            </Section>
          )}
          {view.borrowings.length > 0 && (
            <Section title="Borrowed from people">
              {view.borrowings.map((b) => (
                <BorrowingRow key={b.borrowing.id} item={b} onOpen={onOpen} />
              ))}
            </Section>
          )}
        </div>
      )}

      {archivedCount > 0 && (
        <div className="border-t border-line px-4 py-2 md:px-5">
          <Button variant="link" size="sm" aria-expanded={showArchived} onClick={() => setShowArchived((s) => !s)}>
            {showArchived ? "Hide" : "Show"} archived ({archivedCount})
          </Button>
          {showArchived && (
            <ul aria-label="Archived cards and borrowing" className="mt-1">
              {view.archivedCards.map((c) => (
                <li key={c.card.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0">
                  <p className="min-w-0 flex-1 basis-48 text-sm font-semibold">{c.name}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Restore ${c.name}`}
                    onClick={() => restore(() => setCardArchivedAction({ cardId: c.card.id, archived: false }))}
                  >
                    Restore
                  </Button>
                </li>
              ))}
              {view.archivedBorrowings.map((b) => (
                <li key={b.borrowing.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0">
                  <p className="min-w-0 flex-1 basis-48 text-sm font-semibold">{b.name}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Restore ${b.name}`}
                    onClick={() => restore(() => setBorrowingArchivedAction({ borrowingId: b.borrowing.id, archived: false }))}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-line last:border-b-0">
      <h3 className="px-4 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground md:px-5">{title}</h3>
      <ul>{children}</ul>
    </section>
  )
}

function CardRow({ item, onOpen }: { item: CardItem; onOpen: (open: ShortTermOpen) => void }) {
  const [expanded, setExpanded] = useState(false)
  const { card, latestBill, utilisation } = item
  const c = card.currency
  const id = `card-${card.id}`
  const usedPercent = Math.floor(utilisation.bps / 100)
  const zero = item.owedMinor === 0 && item.creditMinor === 0
  return (
    <li className="border-t border-line first:border-t-0">
      <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2 px-4 py-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_auto] md:items-center md:px-5">
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
              <span className="block text-xs text-muted-foreground">{item.name === card.issuer ? "Credit card" : `${card.issuer} · credit card`}</span>
            </span>
          </button>
        </div>
        <div className="grid gap-0.5 md:text-right">
          <span className={cn(label, "md:sr-only")}>Owed</span>
          <span className="text-sm font-semibold tabular-nums">{money(item.owedMinor, c)}</span>
          {item.creditMinor > 0 && <span className="text-xs text-muted-foreground tabular-nums">{money(item.creditMinor, c)} in credit</span>}
        </div>
        <div className="grid gap-1">
          <span className="flex justify-between gap-2 text-xs tabular-nums">
            <span className="text-muted-foreground">
              {usedPercent}% of {money(card.limitMinor, c)}
            </span>
            {utilisation.level !== "ok" && (
              <span className={cn("font-semibold", utilisation.level === "over" ? "text-danger" : "text-ink")}>{utilisation.level === "over" ? "Over limit" : "Near limit"}</span>
            )}
          </span>
          <Meter valueBp={utilisation.bps} label={`${item.name}: ${usedPercent}% of the limit used`} tone={utilisation.level === "over" ? "over" : utilisation.level === "high" ? "warning" : "default"} />
        </div>
        <div className="grid gap-0.5 md:justify-items-end md:text-right">
          <span className={cn(label, "md:sr-only")}>Latest bill</span>
          {latestBill ? (
            <span className="text-xs tabular-nums">
              <span className="font-semibold text-sm">{money(latestBill.amountDueMinor, c)}</span> · due {fullDate(latestBill.dueDate)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No bill yet</span>
          )}
          <Badge tone={CARD_TONE[item.badge]}>{cardBadgeText(item)}</Badge>
        </div>
        <div className="col-span-2 -mr-2 flex flex-wrap justify-end gap-0.5 md:col-span-1">
          <Button variant="ghost" size="sm" aria-label={`Enter statement for ${item.name}`} onClick={() => onOpen({ kind: "statement", card: item })}>
            Statement
          </Button>
          {item.owedMinor > 0 && (
            <Button variant="secondary" size="sm" aria-label={`Pay ${item.name}`} onClick={() => onOpen({ kind: "payCard", card: item })}>
              Pay
            </Button>
          )}
        </div>
      </div>
      {item.statementToAdd && (
        <p role="note" className="mx-4 mb-2 rounded-lg bg-chip-blue px-3 py-1.5 text-xs font-semibold md:mx-5">
          Add your {item.name} statement of {fullDate(item.statementToAdd)}.
        </p>
      )}
      {expanded && (
        <div id={id} className="mx-4 mb-3 grid gap-3 rounded-xl bg-canvas px-3 py-3 md:mx-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
            <Fact term="Issuer">{card.issuer}</Fact>
            <Fact term="Statement day">{card.statementDay}</Fact>
            <Fact term="Due day">{card.dueDay}</Fact>
            <Fact term="Tracking since">{fullDate(card.trackingStartedOn)}</Fact>
          </dl>
          {item.pendingBill?.plannedOn && (
            <p className="text-xs text-muted-foreground">
              Bill planned for {fullDate(item.pendingBill.plannedOn)}
              {item.pendingBill.plannedAccountName && ` from ${item.pendingBill.plannedAccountName}`}.
            </p>
          )}
          <div className="-ml-2 flex flex-wrap gap-0.5">
            {item.pendingBill && (
              <Button variant="ghost" size="sm" aria-label={`Will pay the ${item.name} bill later`} onClick={() => onOpen({ kind: "planBill", card: item })}>
                Will pay later
              </Button>
            )}
            <Button variant="ghost" size="sm" aria-label={`Edit ${item.name}`} onClick={() => onOpen({ kind: "editCard", card: item })}>
              Edit
            </Button>
            {zero ? (
              <Button variant="ghost" size="sm" aria-label={`Archive ${item.name}`} onClick={() => onOpen({ kind: "archiveCard", card: item })}>
                Archive
              </Button>
            ) : (
              <span className="self-center px-2 text-xs text-muted-foreground">Archive once the balance is zero</span>
            )}
            {!item.hasHistory && (
              <Button variant="ghost" size="sm" className="text-danger" aria-label={`Delete ${item.name}`} onClick={() => onOpen({ kind: "deleteCard", card: item })}>
                Delete
              </Button>
            )}
          </div>
          {item.statements.length > 0 && (
            <List title="Statements">
              {item.statements.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line py-1.5 text-sm last:border-b-0">
                  <span className="min-w-0 flex-1 basis-40 tabular-nums">
                    <span className="font-semibold">{fullDate(s.statementDate)}</span> · total {money(s.totalMinor, c)}
                    {s.emiIncludedMinor > 0 && ` · EMIs ${money(s.emiIncludedMinor, c)}`}
                    {s.differenceMinor > 0 && ` · difference recorded ${money(s.differenceMinor, c)}`}
                  </span>
                  {s.deletable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete the statement of ${fullDate(s.statementDate)}`}
                      onClick={() => onOpen({ kind: "deleteStatement", card: item, statementId: s.id, statementDate: s.statementDate })}
                    >
                      Delete
                    </Button>
                  )}
                </li>
              ))}
            </List>
          )}
          {item.payments.length > 0 && (
            <PaymentList
              payments={item.payments}
              currency={c}
              onEdit={(p) => onOpen({ kind: "editCardPayment", card: item, payment: p })}
              onVoid={(p) => onOpen({ kind: "voidCardPayment", card: item, payment: p })}
            />
          )}
        </div>
      )}
    </li>
  )
}

const RELATIONSHIP_LABEL = Object.fromEntries(BORROWING_RELATIONSHIP_OPTIONS.map((o) => [o.value, o.label])) as Record<string, string>

const DUE_STATUS: Record<BorrowingDue["status"], string> = { pending: "Due", paid: "Paid", before_tracking: "Before tracking" }

function planText(item: BorrowingItem): string {
  const b = item.borrowing
  if (!b.returnOn) return "No return date"
  if (b.returnPlan === "instalments") return `${b.instalmentCount} monthly instalments from ${fullDate(b.returnOn)}`
  return `One-time settlement on ${fullDate(b.returnOn)}`
}

function BorrowingRow({ item, onOpen }: { item: BorrowingItem; onOpen: (open: ShortTermOpen) => void }) {
  const [expanded, setExpanded] = useState(false)
  const { borrowing, due } = item
  const c = borrowing.currency
  const id = `borrowing-${borrowing.id}`
  const pending = due?.status === "pending" ? due : null
  const instalments = borrowing.returnPlan === "instalments"
  const subtitle = [borrowing.relationship ? RELATIONSHIP_LABEL[borrowing.relationship] : "Borrowed", borrowing.reason].filter(Boolean).join(" · ")
  return (
    <li className="border-t border-line first:border-t-0">
      <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2 px-4 py-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_auto] md:items-center md:px-5">
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
              <span className="block text-xs text-muted-foreground">{subtitle}</span>
            </span>
          </button>
        </div>
        <div className="grid gap-0.5 md:text-right">
          <span className={cn(label, "md:sr-only")}>Still owed</span>
          <span className="text-sm font-semibold tabular-nums">{money(item.owedMinor, c)}</span>
          <span className="text-xs text-muted-foreground tabular-nums">of {money(borrowing.borrowedMinor, c)}</span>
        </div>
        <div className="grid gap-0.5 md:text-right">
          <span className={cn(label, "md:sr-only")}>Due</span>
          <span className="text-xs tabular-nums">
            {pending
              ? `${instalments ? `Instalment ${pending.seq} of ${borrowing.instalmentCount}: ` : ""}${money(pending.remainingMinor, c)} due ${fullDate(pending.dueDate)}`
              : due
                ? "All instalments paid"
                : "No return date"}
          </span>
        </div>
        <div className="md:flex md:justify-end">
          <Badge tone={BORROWING_TONE[item.badge]}>{BORROWING_BADGE_LABEL[item.badge]}</Badge>
        </div>
        <div className="col-span-2 -mr-2 flex flex-wrap justify-end gap-0.5 md:col-span-1">
          {item.owedMinor > 0 && (
            <Button variant="secondary" size="sm" aria-label={`Repay ${item.name}`} onClick={() => onOpen({ kind: "repay", borrowing: item, due: pending ?? undefined })}>
              Repay
            </Button>
          )}
        </div>
      </div>
      {!borrowing.relationship && (
        <p role="note" className="mx-4 mb-2 flex flex-wrap items-center gap-x-2 rounded-lg bg-chip-blue px-3 py-1 text-xs font-semibold md:mx-5">
          Say who {item.name} is to you and what it was for.
          <Button variant="link" size="sm" aria-label={`Add details for ${item.name}`} onClick={() => onOpen({ kind: "details", borrowing: item })}>
            Add details
          </Button>
        </p>
      )}
      {expanded && (
        <div id={id} className="mx-4 mb-3 grid gap-3 rounded-xl bg-canvas px-3 py-3 md:mx-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
            <Fact term="Borrowed">{money(borrowing.borrowedMinor, c)}</Fact>
            <Fact term="To return">
              {money(borrowing.amountToReturnMinor, c)}
              {borrowing.amountToReturnMinor > borrowing.borrowedMinor && (
                <span className="block text-xs text-muted-foreground">interest {money(borrowing.amountToReturnMinor - borrowing.borrowedMinor, c)}</span>
              )}
            </Fact>
            <Fact term="Repaid">{money(item.repaidMinor, c)}</Fact>
            <Fact term="Received">{borrowing.receivedOn ? `${fullDate(borrowing.receivedOn)}${item.receiptAccountName ? ` into ${item.receiptAccountName}` : ""}` : "Earlier (not recorded)"}</Fact>
          </dl>
          <p className="text-xs text-muted-foreground">
            {planText(item)}
            {due?.payFromAccountName && ` · from ${due.payFromAccountName}`}. Nothing is deducted until you confirm Paid.
          </p>
          {item.dues.length > 0 && (
            <List title={instalments ? "Instalments" : "Return"}>
              {item.dues.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line py-1.5 text-sm last:border-b-0">
                  <span className="min-w-0 flex-1 basis-48 tabular-nums">
                    <span className="font-semibold">{fullDate(d.dueDate)}</span> · {money(d.amountDueMinor, c)}
                    {d.interestMinor > 0 && <span className="text-xs text-muted-foreground"> (interest {money(d.interestMinor, c)})</span>}
                    {d.status === "pending" && d.remainingMinor < d.amountDueMinor && ` · ${money(d.remainingMinor, c)} left`}
                    {d.plannedOn && d.status === "pending" && ` · planned ${fullDate(d.plannedOn)}${d.plannedAccountName ? ` from ${d.plannedAccountName}` : ""}`}
                  </span>
                  {d.status === "pending" ? (
                    <span className="flex gap-0.5">
                      <Button variant="ghost" size="sm" aria-label={`Will pay the ${fullDate(d.dueDate)} payment later`} onClick={() => onOpen({ kind: "planBorrowingDue", borrowing: item, due: d })}>
                        Will pay later
                      </Button>
                      <Button variant="secondary" size="sm" aria-label={`Pay the ${fullDate(d.dueDate)} payment to ${item.name}`} onClick={() => onOpen({ kind: "repay", borrowing: item, due: d })}>
                        Pay
                      </Button>
                    </span>
                  ) : (
                    <Badge tone="positive">{DUE_STATUS[d.status]}</Badge>
                  )}
                </li>
              ))}
            </List>
          )}
          <div className="-ml-2 flex flex-wrap gap-0.5">
            <Button variant="ghost" size="sm" aria-label={`Change the return plan of ${item.name}`} onClick={() => onOpen({ kind: "returnPlan", borrowing: item })}>
              {borrowing.returnOn ? "Edit return plan" : "Add return date"}
            </Button>
            <Button variant="ghost" size="sm" aria-label={`Edit the details of ${item.name}`} onClick={() => onOpen({ kind: "details", borrowing: item })}>
              {borrowing.relationship ? "Edit details" : "Add details"}
            </Button>
            {item.owedMinor === 0 ? (
              <Button variant="ghost" size="sm" aria-label={`Archive ${item.name}`} onClick={() => onOpen({ kind: "archiveBorrowing", borrowing: item })}>
                Archive
              </Button>
            ) : (
              <span className="self-center px-2 text-xs text-muted-foreground">Archive once repaid</span>
            )}
            {!item.hasRepayments && (
              <Button variant="ghost" size="sm" className="text-danger" aria-label={`Delete ${item.name}`} onClick={() => onOpen({ kind: "deleteBorrowing", borrowing: item })}>
                Delete
              </Button>
            )}
          </div>
          {item.payments.length > 0 && (
            <PaymentList
              payments={item.payments}
              currency={c}
              onEdit={(p) => onOpen({ kind: "editRepayment", borrowing: item, payment: p })}
              onVoid={(p) => onOpen({ kind: "voidRepayment", borrowing: item, payment: p })}
            />
          )}
        </div>
      )}
    </li>
  )
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-0.5">
      <dt className={label}>{term}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  )
}

function List({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
      <ul className="rounded-lg border border-line bg-surface px-3">{children}</ul>
    </div>
  )
}

function PaymentList({ payments, currency, onEdit, onVoid }: { payments: LiabilityPaymentLine[]; currency: string; onEdit: (p: LiabilityPaymentLine) => void; onVoid: (p: LiabilityPaymentLine) => void }) {
  return (
    <List title="Payments">
      {payments.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line py-1.5 text-sm last:border-b-0">
          <span className="min-w-0 flex-1 basis-40 tabular-nums">
            <span className="font-semibold">{money(p.principalMinor + p.interestMinor, currency)}</span> · {fullDate(p.paidOn)} from {p.accountName}
            {p.kind === "bill" && " · bill"}
            {p.interestMinor > 0 && ` · interest ${money(p.interestMinor, currency)}`}
          </span>
          <span className="flex gap-0.5">
            <Button variant="ghost" size="sm" aria-label={`Edit the payment of ${fullDate(p.paidOn)}`} onClick={() => onEdit(p)}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" aria-label={`Void the payment of ${fullDate(p.paidOn)}`} onClick={() => onVoid(p)}>
              Void
            </Button>
          </span>
        </li>
      ))}
    </List>
  )
}

/** The dialogs of the box; rendered inside the page's Dialog. */
export function ShortTermDialogs({
  open,
  view,
  accounts,
  today,
  currency,
  onClose,
}: {
  open: ShortTermOpen
  view: ShortTermView
  accounts: readonly PayingAccount[]
  today: string
  currency: string
  onClose: () => void
}) {
  const eyebrow = "Loans & Liabilities"
  switch (open.kind) {
    case "addCard":
      return (
        <DialogContent eyebrow={eyebrow} title="Add card" description="No card numbers: the issuer and the card's name are enough." className="md:max-w-[640px]">
          <CardForm currency={currency} onDone={onClose} />
        </DialogContent>
      )
    case "editCard":
      return (
        <DialogContent eyebrow={eyebrow} title={`Edit ${open.card.name}`} description="What you owed when you added it stays as entered." className="md:max-w-[640px]">
          <CardForm card={open.card} currency={currency} onDone={onClose} />
        </DialogContent>
      )
    case "statement":
      return (
        <DialogContent eyebrow={open.card.name} title="Enter statement" description="Use the figures on your card statement." className="md:max-w-[640px]">
          <StatementForm item={open.card} today={today} categories={view.expenseCategories} onDone={onClose} />
        </DialogContent>
      )
    case "payCard":
    case "editCardPayment": {
      const bill = open.card.pendingBill
      return (
        <DialogContent
          eyebrow={open.card.name}
          title={open.kind === "payCard" ? "Pay card" : "Edit payment"}
          description={
            open.kind === "editCardPayment"
              ? "The transfer is voided and posted again."
              : bill
                ? `Bill ${money(bill.amountDueMinor, open.card.card.currency)}, due ${fullDate(bill.dueDate)}${bill.paidMinor > 0 ? `; ${money(bill.paidMinor, open.card.card.currency)} paid so far` : ""}.`
                : `You owe ${money(open.card.owedMinor, open.card.card.currency)}.`
          }
        >
          <CardPayForm item={open.card} accounts={accounts} today={today} payment={open.kind === "editCardPayment" ? open.payment : undefined} onDone={onClose} />
        </DialogContent>
      )
    }
    case "planBill":
      return (
        <DialogContent eyebrow={open.card.name} title="Will pay the bill later" description="The bill stays due; we remind you the day before and on the day.">
          <PlanBillForm item={open.card} accounts={accounts} today={today} onDone={onClose} />
        </DialogContent>
      )
    case "voidCardPayment":
      return (
        <DialogContent
          eyebrow={open.card.name}
          title="Void this payment?"
          description={`${money(open.payment.principalMinor, open.card.card.currency)} paid ${fullDate(open.payment.paidOn)}. It is owed on the card again${open.payment.kind === "bill" ? " and the bill is due again" : ""}.`}
        >
          <VoidForm payment={open.payment} subject="card" onDone={onClose} />
        </DialogContent>
      )
    case "deleteStatement":
      return (
        <DialogContent eyebrow={open.card.name} title={`Delete the statement of ${fullDate(open.statementDate)}?`} description="Its bill is removed, and so is the difference expense if one was recorded.">
          <ConfirmAction label="Delete statement" pendingLabel="Deleting…" destructive action={() => deleteStatementAction({ statementId: open.statementId })} onDone={onClose} />
        </DialogContent>
      )
    case "archiveCard":
      return (
        <DialogContent eyebrow={eyebrow} title={`Archive ${open.card.name}?`} description="It moves to Archived: no reminders and no purchases until you restore it. Its history stays.">
          <ConfirmAction label="Archive" pendingLabel="Archiving…" action={() => setCardArchivedAction({ cardId: open.card.card.id, archived: true, currency: open.card.card.currency })} onDone={onClose} />
        </DialogContent>
      )
    case "deleteCard":
      return (
        <DialogContent eyebrow={eyebrow} title={`Delete ${open.card.name}?`} description="The card is removed for good. This can't be undone.">
          <ConfirmAction label="Delete card" pendingLabel="Deleting…" destructive action={() => deleteCardAction({ cardId: open.card.card.id })} onDone={onClose} />
        </DialogContent>
      )
    case "linkEmi":
      return (
        <DialogContent eyebrow={open.loan.name} title="Link to card" description="Its EMIs then fill “Card EMIs included” when you enter that card's statement.">
          <LinkEmiForm loan={open.loan} cards={view.cards} onDone={onClose} />
        </DialogContent>
      )
    case "addBorrowing":
      return (
        <DialogContent eyebrow={eyebrow} title="Add borrowing" description="Money borrowed from friends, family or others." className={TALL_DIALOG}>
          <BorrowingForm accounts={accounts} today={today} currency={currency} onDone={onClose} />
        </DialogContent>
      )
    case "repay":
    case "editRepayment": {
      const due = open.kind === "repay" ? open.due : undefined
      const c = open.borrowing.borrowing.currency
      return (
        <DialogContent
          eyebrow={open.borrowing.name}
          title={open.kind === "editRepayment" ? "Edit repayment" : due ? (due.seq > 0 ? `Pay instalment ${due.seq}` : "Pay") : "Repay"}
          description={
            open.kind === "editRepayment"
              ? "Every part of the repayment changes together."
              : due
                ? `${money(due.remainingMinor, c)} due ${fullDate(due.dueDate)}. Change anything before you confirm.`
                : `Still owed ${money(open.borrowing.owedMinor, c)}.`
          }
        >
          <RepayForm item={open.borrowing} due={due} accounts={accounts} today={today} payment={open.kind === "editRepayment" ? open.payment : undefined} onDone={onClose} />
        </DialogContent>
      )
    }
    case "planBorrowingDue":
      return (
        <DialogContent eyebrow={open.borrowing.name} title="Will pay later" description={`${money(open.due.remainingMinor, open.borrowing.borrowing.currency)} due ${fullDate(open.due.dueDate)} stays due; we remind you the day before and on the day.`}>
          <PlanBorrowingDueForm due={open.due} currency={open.borrowing.borrowing.currency} accounts={accounts} today={today} onDone={onClose} />
        </DialogContent>
      )
    case "voidRepayment":
      return (
        <DialogContent
          eyebrow={open.borrowing.name}
          title="Void this repayment?"
          description={`${money(open.payment.principalMinor + open.payment.interestMinor, open.borrowing.borrowing.currency)} paid ${fullDate(open.payment.paidOn)}. It is owed again.`}
        >
          <VoidForm payment={open.payment} subject="borrowing" onDone={onClose} />
        </DialogContent>
      )
    case "returnPlan":
      return (
        <DialogContent
          eyebrow={open.borrowing.name}
          title={open.borrowing.borrowing.returnOn ? "Edit return plan" : "Add return date"}
          description="Reminders follow each date: the day before and on the day."
          className={TALL_DIALOG}
        >
          <ReturnPlanForm item={open.borrowing} accounts={accounts} today={today} onDone={onClose} />
        </DialogContent>
      )
    case "details":
      return (
        <DialogContent eyebrow={open.borrowing.name} title={open.borrowing.borrowing.relationship ? "Edit details" : "Add details"} description="Names only: no account or card numbers.">
          <BorrowingDetailsForm item={open.borrowing} onDone={onClose} />
        </DialogContent>
      )
    case "archiveBorrowing":
      return (
        <DialogContent eyebrow={eyebrow} title={`Archive ${open.borrowing.name}?`} description="It moves to Archived. Its history stays.">
          <ConfirmAction
            label="Archive"
            pendingLabel="Archiving…"
            action={() => setBorrowingArchivedAction({ borrowingId: open.borrowing.borrowing.id, archived: true, currency: open.borrowing.borrowing.currency })}
            onDone={onClose}
          />
        </DialogContent>
      )
    case "deleteBorrowing": {
      const b = open.borrowing
      const receipt = b.receiptAccountName
        ? ` It also removes the money-received entry and lowers ${b.receiptAccountName} by ${money(b.borrowing.borrowedMinor, b.borrowing.currency)}.`
        : ""
      return (
        <DialogContent eyebrow={eyebrow} title={`Delete ${b.name}?`} description={`The borrowing is removed for good.${receipt} This can't be undone.`}>
          <ConfirmAction label="Delete borrowing" pendingLabel="Deleting…" destructive action={() => deleteBorrowingAction({ borrowingId: b.borrowing.id })} onDone={onClose} />
        </DialogContent>
      )
    }
  }
}

function VoidForm({ payment, subject, onDone }: { payment: LiabilityPaymentLine; subject: "card" | "borrowing"; onDone: () => void }) {
  const [requestKey] = useState(newRequestKey)
  const [reason, setReason] = useState("")
  return (
    <div className="grid gap-3">
      <TextField name="reason" label="Reason (optional)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoComplete="off" />
      <ConfirmAction
        label="Void payment"
        pendingLabel="Voiding…"
        destructive
        action={() =>
          payment.kind === "bill"
            ? voidDuePaymentAction({ paymentId: payment.id, idempotencyKey: requestKey, reason: reason || undefined })
            : voidLiabilityPaymentAction({ paymentId: payment.id, idempotencyKey: requestKey, reason: reason || undefined, subject })
        }
        onDone={onDone}
      />
    </div>
  )
}
