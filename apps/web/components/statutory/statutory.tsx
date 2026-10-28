"use client"

import type * as React from "react"
import { useState, useTransition } from "react"
import { ChevronDown, Plus } from "lucide-react"
import { type StatutoryItem, type StatutoryPaymentLine, type StatutoryView, newRequestKey, statutoryBadgeText } from "@fin-creador/api"
import { STATUTORY_TYPES_WITH_INTEREST, type StatutoryType, addMinor, minorToGroupedInputString, parseAmount, regroupAmountInput, shortfallMinor } from "@fin-creador/domain"
import {
  INDIAN_CITIES,
  INDIAN_STATES,
  type PayingAccount,
  STATUTORY_TYPE_OPTIONS,
  STATUTORY_VEHICLE_OPTIONS,
  shortfallMessage,
} from "@fin-creador/schemas"
import { cn } from "cn"
import {
  addStatutoryDueAction,
  clearDuePlanAction,
  deleteStatutoryDueAction,
  editDuePaymentAction,
  editStatutoryDueAction,
  payDueItemAction,
  planDueItemAction,
  setStatutoryDueArchivedAction,
  voidDuePaymentAction,
} from "@/app/(app)/loans-liabilities/actions"
import { AccountPicker, Footer, NoAccounts, Scroll, ShortfallWarning, TALL_DIALOG, useSubmit } from "@/components/cards/forms"
import { currencySymbol } from "@/components/income/format"
import { Choice } from "@/components/loans/choice"
import { ConfirmAction, run } from "@/components/loans/confirm"
import { inWords } from "@/components/loans/display"
import { fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DialogContent } from "@/components/ui/dialog"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"

// The "Statutory & legal liabilities" box (Sprint 8d, web): income tax payable, fines and
// other statutory dues, what is paid and left, part payments, Will pay later, archive and
// delete. Figures come from packages/api/src/statutory/view.ts. Never challan, RTO or vehicle
// numbers: names only.

export type StatutoryOpen =
  | { kind: "addDue" }
  | { kind: "pay" | "later" | "editDue" | "archiveDue" | "deleteDue"; due: StatutoryItem }
  | { kind: "editPayment" | "voidPayment"; due: StatutoryItem; payment: StatutoryPaymentLine }

const TONE: Record<StatutoryItem["badge"], "positive" | "negative" | "info"> = { due: "info", overdue: "negative", part_paid: "info", paid: "positive" }
const VEHICLE_LABEL = Object.fromEntries(STATUTORY_VEHICLE_OPTIONS.map((o) => [o.value, o.label])) as Record<string, string>
const NOTHING_DEDUCTED = "Nothing is deducted until you confirm Paid."
const label = "text-xs text-muted-foreground"

function subtitle(d: StatutoryItem): string {
  const parts: (string | null | undefined)[] = [d.typeLabel === d.name ? null : d.typeLabel]
  if (d.due.dueType === "fine") parts.push(d.due.vehicleKind ? VEHICLE_LABEL[d.due.vehicleKind] : null, d.due.issuedCity ?? d.due.issuedState)
  return parts.filter(Boolean).join(" · ") || (d.due.dueType === "fine" ? "Fine" : "Statutory due")
}

export function StatutoryBox({ view, currency, onOpen }: { view: StatutoryView; currency: string; onOpen: (open: StatutoryOpen) => void }) {
  const [showArchived, setShowArchived] = useState(false)
  const [busy, startBusy] = useTransition()
  const restore = (d: StatutoryItem) =>
    startBusy(async () => {
      const result = await run(() => setStatutoryDueArchivedAction({ statutoryDueId: d.due.id, archived: false }))
      if (result.status === "success") toast.success(result.message)
      else toast.error(result.message)
    })
  return (
    <Card role="region" aria-labelledby="statutory-title" className="px-0 py-0 md:px-0 md:py-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3.5 pb-2.5 md:px-5">
        <div className="grid gap-0.5">
          <h2 id="statutory-title" className="font-heading text-lg font-bold">
            Statutory &amp; legal liabilities
          </h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            {view.dues.length > 0 && (
              <>
                Still due <span className="font-semibold text-ink">{money(view.totalDueMinor, currency)}</span> ·{" "}
              </>
            )}
            Nothing is posted until you pay
          </p>
        </div>
        <Button onClick={() => onOpen({ kind: "addDue" })}>
          <Plus aria-hidden="true" />
          Add due
        </Button>
      </div>
      {view.dues.length === 0 ? (
        <div className="grid justify-items-start gap-1.5 border-t border-line px-4 py-3 md:px-5">
          <p className="text-sm font-semibold">No dues yet</p>
          <p className="text-sm text-muted-foreground">Add income tax payable, a traffic e-challan or other fine, or another statutory due such as property tax. We remind you when it is due.</p>
        </div>
      ) : (
        <ul className="border-t border-line">
          {view.dues.map((d) => (
            <DueRow key={d.due.id} item={d} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {view.archived.length > 0 && (
        <div className="border-t border-line px-4 py-2 md:px-5">
          <Button variant="link" size="sm" aria-expanded={showArchived} onClick={() => setShowArchived((s) => !s)}>
            {showArchived ? "Hide" : "Show"} archived ({view.archived.length})
          </Button>
          {showArchived && (
            <ul aria-label="Archived dues" className="mt-1">
              {view.archived.map((d) => (
                <li key={d.due.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0">
                  <p className="min-w-0 flex-1 basis-48 text-sm font-semibold">
                    {d.name} <span className="font-normal text-muted-foreground tabular-nums">· {money(d.due.amountMinor, d.due.currency)} paid</span>
                  </p>
                  <Button variant="ghost" size="sm" disabled={busy} aria-label={`Restore ${d.name}`} onClick={() => restore(d)}>
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

function DueRow({ item, onOpen }: { item: StatutoryItem; onOpen: (open: StatutoryOpen) => void }) {
  const [expanded, setExpanded] = useState(false)
  const { due } = item
  const c = due.currency
  const id = `due-${due.id}`
  const pending = item.item.status === "pending"
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
              <span className="block text-xs text-muted-foreground">{subtitle(item)}</span>
            </span>
          </button>
        </div>
        <div className="grid gap-0.5 md:text-right">
          <span className={cn(label, "md:sr-only")}>Amount</span>
          <span className="text-sm font-semibold tabular-nums">{money(due.amountMinor, c)}</span>
          {item.paidMinor > 0 && item.leftMinor > 0 && <span className="text-xs text-muted-foreground tabular-nums">{money(item.leftMinor, c)} left</span>}
        </div>
        <div className="grid gap-0.5 md:text-right">
          <span className={cn(label, "md:sr-only")}>Due</span>
          <span className="text-xs tabular-nums">Due {fullDate(due.dueDate)}</span>
        </div>
        <div className="md:flex md:justify-end">
          <Badge tone={TONE[item.badge]}>{statutoryBadgeText(item)}</Badge>
        </div>
        <div className="col-span-2 -mr-2 flex flex-wrap justify-end gap-0.5 md:col-span-1">
          {pending && (
            <Button variant="secondary" size="sm" aria-label={`Pay ${item.name}`} onClick={() => onOpen({ kind: "pay", due: item })}>
              {item.paidMinor > 0 ? "Pay the rest" : "Pay"}
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        <div id={id} className="mx-4 mb-3 grid gap-3 rounded-xl bg-canvas px-3 py-3 md:mx-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
            <Fact term="Amount">{money(due.amountMinor, c)}</Fact>
            <Fact term="Paid">{money(item.paidMinor, c)}</Fact>
            <Fact term="Left">{money(item.leftMinor, c)}</Fact>
            <Fact term="Pay from">{item.item.payFromAccountName ?? "Not chosen"}</Fact>
            {due.dueType === "fine" && (
              <>
                <Fact term="Vehicle">{due.vehicleKind ? VEHICLE_LABEL[due.vehicleKind] : "Not given"}</Fact>
                <Fact term="Issued in">{[due.issuedCity, due.issuedState].filter(Boolean).join(", ") || "Not given"}</Fact>
              </>
            )}
          </dl>
          {pending && item.item.plannedOn && (
            <p className="text-xs text-muted-foreground">
              Planned for {fullDate(item.item.plannedOn)}
              {item.item.plannedAccountName && ` from ${item.item.plannedAccountName}`}.
            </p>
          )}
          <p className="text-xs text-muted-foreground">{NOTHING_DEDUCTED}</p>
          <div className="-ml-2 flex flex-wrap gap-0.5">
            {pending && (
              <Button variant="ghost" size="sm" aria-label={`Will pay ${item.name} later`} onClick={() => onOpen({ kind: "later", due: item })}>
                Will pay later
              </Button>
            )}
            <Button variant="ghost" size="sm" aria-label={`Edit ${item.name}`} onClick={() => onOpen({ kind: "editDue", due: item })}>
              Edit
            </Button>
            {item.state === "paid" ? (
              <Button variant="ghost" size="sm" aria-label={`Archive ${item.name}`} onClick={() => onOpen({ kind: "archiveDue", due: item })}>
                Archive
              </Button>
            ) : (
              <span className="self-center px-2 text-xs text-muted-foreground">Archive once fully paid</span>
            )}
            {!item.hasHistory && (
              <Button variant="ghost" size="sm" className="text-danger" aria-label={`Delete ${item.name}`} onClick={() => onOpen({ kind: "deleteDue", due: item })}>
                Delete
              </Button>
            )}
          </div>
          {item.payments.length > 0 && (
            <div className="grid gap-1">
              <h4 className="text-xs font-semibold text-muted-foreground">Payments</h4>
              <ul className="rounded-lg border border-line bg-surface px-3">
                {item.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line py-1.5 text-sm last:border-b-0">
                    <span className="min-w-0 flex-1 basis-40 tabular-nums">
                      <span className="font-semibold">{money(p.principalMinor + p.interestMinor, c)}</span> · {fullDate(p.paidOn)} from {p.accountName}
                      {p.interestMinor > 0 && ` · interest or penalty ${money(p.interestMinor, c)}`}
                    </span>
                    <span className="flex gap-0.5">
                      <Button variant="ghost" size="sm" aria-label={`Edit the payment of ${fullDate(p.paidOn)}`} onClick={() => onOpen({ kind: "editPayment", due: item, payment: p })}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Void the payment of ${fullDate(p.paidOn)}`} onClick={() => onOpen({ kind: "voidPayment", due: item, payment: p })}>
                        Void
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
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

// ---------------------------------------------------------------------------
// Add or edit a due
// ---------------------------------------------------------------------------

function DueForm({ due, accounts, currency, onDone }: { due?: StatutoryItem; accounts: readonly PayingAccount[]; currency: string; onDone: () => void }) {
  const [requestKey] = useState(newRequestKey)
  const d = due?.due
  const c = d?.currency ?? currency
  const eligible = accounts.filter((a) => a.currency === c)
  const [values, setValues] = useState({
    dueType: d?.dueType ?? "",
    amount: d ? minorToGroupedInputString(d.amountMinor, c) : "",
    dueDate: d?.dueDate ?? "",
    description: d?.description ?? "",
    vehicleKind: d?.vehicleKind ?? "",
    issuedState: d?.issuedState ?? "",
    issuedCity: d?.issuedCity ?? "",
    payFromAccountId: d?.payFromAccountId && eligible.some((a) => a.id === d.payFromAccountId) ? d.payFromAccountId : "",
  })
  const { errors, formError, pending, submit } = useSubmit(onDone)
  const set = (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [name]: e.target.value }))
  const fine = values.dueType === "fine"
  const sym = currencySymbol(c)
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        const input = { ...values, ...(fine ? {} : { vehicleKind: "", issuedState: "", issuedCity: "" }) }
        void submit(() => (due ? editStatutoryDueAction({ ...input, statutoryDueId: due.due.id }) : addStatutoryDueAction({ ...input, idempotencyKey: requestKey })))
      }}
    >
      <Scroll>
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
        {!due && (
          <Choice name="dueType" legend="What is it?" value={values.dueType} options={STATUTORY_TYPE_OPTIONS} error={errors.dueType} onChange={(v) => setValues((s) => ({ ...s, dueType: v }))} grid />
        )}
        <TextField
          name="description"
          label={values.dueType === "other_statutory" ? "What it is" : "Description (optional)"}
          placeholder={values.dueType === "other_statutory" ? "e.g. Property tax" : fine ? "e.g. Signal jump" : "e.g. Advance tax"}
          maxLength={120}
          value={values.description}
          error={errors.description}
          onChange={set("description")}
          autoComplete="off"
          hint="No challan, RTO or vehicle numbers"
        />
        <div className="grid items-start gap-3 md:grid-cols-2">
          <TextField
            name="amount"
            label={`Amount (${sym})`}
            inputMode="decimal"
            autoComplete="off"
            value={values.amount}
            error={errors.amount}
            hint={due && due.paidMinor > 0 ? `At least ${money(due.paidMinor, c)}, already paid` : undefined}
            onChange={set("amount")}
            onBlur={() => setValues((v) => ({ ...v, amount: regroupAmountInput(v.amount, c) }))}
          />
          <TextField name="dueDate" type="date" label="Due date" value={values.dueDate} error={errors.dueDate} hint={inWords(values.dueDate) ?? "A past date is fine if it is already overdue"} onChange={set("dueDate")} />
        </div>
        {fine && (
          <div className="grid items-start gap-3 md:grid-cols-3">
            <SelectField name="vehicleKind" label="Vehicle (optional)" value={values.vehicleKind} error={errors.vehicleKind} onChange={set("vehicleKind")}>
              <option value="">Not given</option>
              {STATUTORY_VEHICLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectField>
            <SelectField name="issuedState" label="Issued in state (optional)" value={values.issuedState} error={errors.issuedState} onChange={set("issuedState")}>
              <option value="">Not given</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectField>
            <SelectField name="issuedCity" label="City (optional)" value={values.issuedCity} error={errors.issuedCity} onChange={set("issuedCity")}>
              <option value="">Not given</option>
              {INDIAN_CITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectField>
          </div>
        )}
        <AccountPicker
          name="payFromAccountId"
          label="Pay from (optional)"
          hint="Bank, Cash in hand or other account"
          accounts={eligible}
          value={values.payFromAccountId}
          error={errors.payFromAccountId}
          onChange={(id) => setValues((v) => ({ ...v, payFromAccountId: id }))}
        />
        <p className="text-xs text-muted-foreground">{NOTHING_DEDUCTED}</p>
      </Scroll>
      <Footer pending={pending} label={due ? "Save due" : "Add due"} />
    </form>
  )
}

// ---------------------------------------------------------------------------
// Pay (or change a payment), Will pay later
// ---------------------------------------------------------------------------

function PayForm({
  due,
  accounts,
  today,
  payment,
  onDone,
}: {
  due: StatutoryItem
  accounts: readonly PayingAccount[]
  today: string
  payment?: StatutoryPaymentLine
  onDone: () => void
}) {
  const [requestKey] = useState(newRequestKey)
  const c = due.due.currency
  const eligible = accounts.filter((a) => a.currency === c)
  const usable = (id: string | null) => (id && eligible.some((a) => a.id === id) ? id : null)
  const wanted = due.item.plannedAccountId ?? due.item.payFromAccountId
  const gone = !payment && wanted !== null && !usable(wanted)
  const interestAllowed = STATUTORY_TYPES_WITH_INTEREST.includes(due.due.dueType as StatutoryType)
  const [values, setValues] = useState({
    accountId: payment?.accountId ?? (gone ? "" : (usable(wanted) ?? eligible[0]?.id ?? "")),
    paidOn: payment?.paidOn ?? today,
    principal: minorToGroupedInputString(payment ? payment.principalMinor : due.leftMinor, c),
    interest: payment && payment.interestMinor > 0 ? minorToGroupedInputString(payment.interestMinor, c) : "",
  })
  const { errors, formError, serverShort, setServerShort, pending, submit } = useSubmit(onDone)
  const sym = currencySymbol(c)
  const set = (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setServerShort(null)
    setValues((v) => ({ ...v, [name]: e.target.value }))
  }
  const parts = [values.principal, interestAllowed ? values.interest : ""].map((v) => parseAmount(v || "0", c, { allowZero: true }))
  const total = parts.every((p) => p.ok) ? addMinor(...parts.map((p) => (p.ok ? p.minor : 0))) : null
  const account = eligible.find((a) => a.id === values.accountId)
  const back = payment && account && payment.accountId === account.id ? addMinor(payment.principalMinor, payment.interestMinor) : 0
  const short = total !== null && account ? shortfallMinor(account.balanceMinor + back, total) : 0
  const warning = serverShort ?? (short > 0 && account ? shortfallMessage(short, account.name, c, "this due") : null)
  const left = due.leftMinor + (payment?.principalMinor ?? 0)
  function save(allowShortfall: boolean) {
    const input = {
      accountId: values.accountId,
      paidOn: values.paidOn,
      principal: values.principal,
      interest: interestAllowed ? values.interest : "",
      fees: "",
      allowShortfall: allowShortfall ? "true" : "",
      idempotencyKey: requestKey,
    }
    void submit(() => (payment ? editDuePaymentAction({ ...input, paymentId: payment.id }) : payDueItemAction({ ...input, dueItemId: due.item.id })))
  }
  if (eligible.length === 0) return <NoAccounts />
  return (
    <form
      noValidate
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        save(false)
      }}
    >
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      {gone && <FormMessage tone="info">{due.item.payFromAccountName ? `${due.item.payFromAccountName} is archived.` : "The planned account is gone."} Choose the account you paid from.</FormMessage>}
      <AccountPicker
        label="Paid from"
        accounts={eligible}
        value={values.accountId}
        error={errors.accountId}
        onChange={(id) => {
          setServerShort(null)
          setValues((v) => ({ ...v, accountId: id }))
        }}
      />
      <TextField name="paidOn" type="date" label="Paid on" max={today} value={values.paidOn} error={errors.paidOn} hint={inWords(values.paidOn)} onChange={set("paidOn")} />
      <div className="grid items-start gap-3 md:grid-cols-2">
        <TextField
          name="principal"
          label={`Amount paid (${sym})`}
          inputMode="decimal"
          autoComplete="off"
          value={values.principal}
          error={errors.principal}
          hint={`${money(left, c)} still due; part payments are fine`}
          onChange={set("principal")}
          onBlur={() => setValues((v) => ({ ...v, principal: regroupAmountInput(v.principal, c) }))}
        />
        {interestAllowed && (
          <TextField
            name="interest"
            label={`Interest or penalty (${sym}, optional)`}
            inputMode="decimal"
            placeholder="0"
            autoComplete="off"
            value={values.interest}
            error={errors.interest}
            hint="Not part of the amount due"
            onChange={set("interest")}
            onBlur={() => setValues((v) => ({ ...v, interest: regroupAmountInput(v.interest, c) }))}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {due.due.dueType === "fine" ? "Posted as an expense in Fines & penalties." : "Posted as an expense in Taxes; interest or a penalty in Fines & penalties."}
      </p>
      {warning && <ShortfallWarning warning={warning} pending={pending} onPayAnyway={() => save(true)} />}
      <Footer pending={pending} label={payment ? "Save payment" : "Paid"}>
        {total !== null && (
          <>
            <span className="font-semibold">Total </span>
            <span className="font-heading text-lg font-bold">{money(total, c)}</span>
          </>
        )}
      </Footer>
    </form>
  )
}

function LaterForm({ due, accounts, today, onDone }: { due: StatutoryItem; accounts: readonly PayingAccount[]; today: string; onDone: () => void }) {
  const eligible = accounts.filter((a) => a.currency === due.due.currency)
  const first = [due.item.plannedAccountId, due.item.payFromAccountId].find((id) => id && eligible.some((a) => a.id === id)) ?? eligible[0]?.id ?? ""
  const [values, setValues] = useState({ accountId: first, plannedOn: due.item.plannedOn ?? today })
  const { errors, formError, pending, submit } = useSubmit(onDone)
  if (eligible.length === 0) return <NoAccounts />
  return (
    <form
      noValidate
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(() => planDueItemAction({ dueItemId: due.item.id, ...values }))
      }}
    >
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <AccountPicker label="Will pay from" accounts={eligible} value={values.accountId} error={errors.accountId} onChange={(id) => setValues((v) => ({ ...v, accountId: id }))} />
      <TextField name="plannedOn" type="date" label="Pay on" min={today} value={values.plannedOn} error={errors.plannedOn} hint={inWords(values.plannedOn)} onChange={(e) => setValues((v) => ({ ...v, plannedOn: e.target.value }))} />
      {due.item.plannedOn && (
        <div>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void submit(() => clearDuePlanAction({ dueItemId: due.item.id }))}>
            Remove plan
          </Button>
        </div>
      )}
      <Footer pending={pending} label="Save plan" />
    </form>
  )
}

function VoidForm({ payment, onDone }: { payment: StatutoryPaymentLine; onDone: () => void }) {
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

/** The dialogs of the box; rendered inside the page's Dialog. */
export function StatutoryDialogs({
  open,
  accounts,
  today,
  currency,
  onClose,
}: {
  open: StatutoryOpen
  accounts: readonly PayingAccount[]
  today: string
  currency: string
  onClose: () => void
}) {
  const eyebrow = "Loans & Liabilities"
  switch (open.kind) {
    case "addDue":
      return (
        <DialogContent eyebrow={eyebrow} title="Add due" description="Income tax payable, a fine or another statutory due. Names only: no challan, RTO or vehicle numbers." className={TALL_DIALOG}>
          <DueForm accounts={accounts} currency={currency} onDone={onClose} />
        </DialogContent>
      )
    case "editDue":
      return (
        <DialogContent eyebrow={open.due.name} title="Edit due" description="The amount can't go below what is already paid." className={TALL_DIALOG}>
          <DueForm due={open.due} accounts={accounts} currency={currency} onDone={onClose} />
        </DialogContent>
      )
    case "pay":
    case "editPayment": {
      const d = open.due
      return (
        <DialogContent
          eyebrow={d.name}
          title={open.kind === "editPayment" ? "Edit payment" : d.paidMinor > 0 ? "Pay the rest" : "Pay"}
          description={
            open.kind === "editPayment"
              ? "Every part of the payment changes together."
              : `${money(d.leftMinor, d.due.currency)} still due ${d.item.dueDate < today ? "since" : "on"} ${fullDate(d.due.dueDate)}. Change anything before you confirm.`
          }
        >
          <PayForm due={d} accounts={accounts} today={today} payment={open.kind === "editPayment" ? open.payment : undefined} onDone={onClose} />
        </DialogContent>
      )
    }
    case "later":
      return (
        <DialogContent eyebrow={open.due.name} title="Will pay later" description={`${money(open.due.leftMinor, open.due.due.currency)} stays due; we remind you the day before and on the day.`}>
          <LaterForm due={open.due} accounts={accounts} today={today} onDone={onClose} />
        </DialogContent>
      )
    case "voidPayment":
      return (
        <DialogContent
          eyebrow={open.due.name}
          title="Void this payment?"
          description={`${money(open.payment.principalMinor + open.payment.interestMinor, open.due.due.currency)} paid ${fullDate(open.payment.paidOn)}. Its expense is voided and the amount is due again.`}
        >
          <VoidForm payment={open.payment} onDone={onClose} />
        </DialogContent>
      )
    case "archiveDue":
      return (
        <DialogContent eyebrow={eyebrow} title={`Archive ${open.due.name}?`} description="It moves to Archived. Its payments stay in your expenses.">
          <ConfirmAction
            label="Archive"
            pendingLabel="Archiving…"
            action={() => setStatutoryDueArchivedAction({ statutoryDueId: open.due.due.id, archived: true, currency: open.due.due.currency })}
            onDone={onClose}
          />
        </DialogContent>
      )
    case "deleteDue":
      return (
        <DialogContent eyebrow={eyebrow} title={`Delete ${open.due.name}?`} description="It was never paid, so it is removed for good. This can't be undone.">
          <ConfirmAction label="Delete due" pendingLabel="Deleting…" destructive action={() => deleteStatutoryDueAction({ statutoryDueId: open.due.due.id })} onDone={onClose} />
        </DialogContent>
      )
  }
}
