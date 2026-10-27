"use client"

import type * as React from "react"
import { useState } from "react"
import { type BorrowingItem, type CardItem, type CardWriteResult, type LiabilityPaymentLine, type LoanItem, type WriteResult, newRequestKey } from "@fin-creador/api"
import { addMinor, cardDueDate, emisInCycle, latestStatementCycle, minorToGroupedInputString, parseAmount, regroupAmountInput, shortfallMinor } from "@fin-creador/domain"
import { BORROWING_RECEIVED_OPTIONS, CARD_EMI_NOTE, LENDERS, type PayingAccount, shortfallMessage } from "@fin-creador/schemas"
import {
  addBorrowingAction,
  addCardAction,
  editCardAction,
  editDuePaymentAction,
  editLiabilityPaymentAction,
  enterStatementAction,
  linkCardEmiAction,
  payCardAction,
  payDueItemAction,
  planDueItemAction,
  clearDuePlanAction,
  repayBorrowingAction,
  setBorrowingDueDateAction,
} from "@/app/(app)/loans-liabilities/actions"
import { currencySymbol } from "@/components/income/format"
import { Choice } from "@/components/loans/choice"
import { run } from "@/components/loans/confirm"
import { inWords } from "@/components/loans/display"
import { fullDate, money } from "@/components/transactions/display"
import { Button } from "@/components/ui/button"
import { DialogClose } from "@/components/ui/dialog"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"

// Forms of the "Short-term & operational liabilities" box (Sprint 8b): add or edit a card,
// enter a statement, pay a card or its bill, plan a bill, link a card EMI, add a borrowing,
// repay it and change its due date. Every check is repeated by the shared schemas on the
// server and again by the database. Names never hold digits.

type Result = WriteResult & { shortfallMinor?: number }

/** Form state, field errors, a form message and a server-side shortfall ("Pay anyway"). */
function useSubmit(onDone: () => void) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [serverShort, setServerShort] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  async function submit(save: () => Promise<Result>) {
    if (pending) return
    setPending(true)
    setFormError(null)
    const result = await run(save)
    setPending(false)
    if (result.status === "success") {
      toast.success(result.message)
      onDone()
      return
    }
    const fieldErrors = ("fieldErrors" in result ? result.fieldErrors : undefined) ?? {}
    if ("shortfallMinor" in result && result.shortfallMinor) {
      // Shown once, in the warning with "Pay anyway", not also under the account.
      setServerShort(fieldErrors.accountId ?? result.message)
      setErrors({ ...fieldErrors, accountId: "" })
      return
    }
    setFormError(result.message)
    setErrors(fieldErrors)
  }
  return { errors, formError, serverShort, setServerShort, pending, submit }
}

function Footer({ pending, label, children }: { pending: boolean; label: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
      <div aria-live="polite" className="text-sm tabular-nums">
        {children}
      </div>
      <div className="flex flex-wrap gap-2">
        <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : label}
        </Button>
      </div>
    </div>
  )
}

function ShortfallWarning({ warning, pending, onPayAnyway }: { warning: string; pending: boolean; onPayAnyway: () => void }) {
  return (
    <div role="alert" className="grid gap-2 rounded-xl bg-chip-peach px-3 py-2.5 text-sm text-danger">
      <p className="font-semibold">{warning}.</p>
      <p className="text-ink">Choose another account, or pay anyway if you will add money first.</p>
      <div>
        <Button type="button" size="sm" disabled={pending} aria-busy={pending} onClick={onPayAnyway}>
          Pay anyway
        </Button>
      </div>
    </div>
  )
}

const accountLabel = (a: PayingAccount) => `${a.name} · ${money(a.balanceMinor, a.currency)}`

function AccountPicker({ label, accounts, value, error, onChange }: { label: string; accounts: readonly PayingAccount[]; value: string; error?: string; onChange: (id: string) => void }) {
  return (
    <SelectField name="accountId" label={label} value={value} error={error || undefined} onChange={(e) => onChange(e.target.value)} hint="Bank, cash and other accounts, with balances">
      <option value="">Choose an account</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {accountLabel(a)}
        </option>
      ))}
    </SelectField>
  )
}

const NO_ACCOUNTS = "Add a bank, cash or other account on the Income page first."

function NoAccounts() {
  return (
    <div className="grid gap-3">
      <FormMessage tone="info">{NO_ACCOUNTS}</FormMessage>
      <div className="flex justify-end">
        <DialogClose render={<Button type="button" variant="secondary" />}>Close</DialogClose>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add or edit a card
// ---------------------------------------------------------------------------

export function CardForm({ card, currency, onDone }: { card?: CardItem; currency: string; onDone: () => void }) {
  const [requestKey] = useState(newRequestKey)
  const c = card?.card
  const [values, setValues] = useState({
    issuer: c?.issuer ?? "",
    nickname: c?.nickname ?? "",
    limit: c ? minorToGroupedInputString(c.limitMinor, c.currency) : "",
    statementDay: c ? String(c.statementDay) : "",
    dueDay: c ? String(c.dueDay) : "",
    openingOwed: "",
  })
  const { errors, formError, pending, submit } = useSubmit(onDone)
  const sym = currencySymbol(c?.currency ?? currency)
  const set = (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [name]: e.target.value }))
  const regroup = (name: "limit" | "openingOwed") => () => setValues((v) => ({ ...v, [name]: regroupAmountInput(v[name], c?.currency ?? currency) }))
  const field = (name: keyof typeof values, label: string, props: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField name={name} label={label} value={values[name]} error={errors[name]} onChange={set(name)} autoComplete="off" {...props} />
  )
  const day = { inputMode: "numeric" as const, maxLength: 2, placeholder: "1 to 31" }
  return (
    <form
      noValidate
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit((): Promise<CardWriteResult> => (c ? editCardAction({ ...values, cardId: c.id }) : addCardAction({ ...values, idempotencyKey: requestKey })))
      }}
    >
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <div className="grid items-start gap-3 md:grid-cols-2">
        {field("issuer", "Card issuer", { list: "card-issuers", maxLength: 80, hint: "Pick from the list or type any name" })}
        <datalist id="card-issuers">
          {LENDERS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        {field("nickname", "Nickname (optional)", { maxLength: 40, placeholder: "e.g. Travel card", hint: "No card numbers or digits" })}
      </div>
      <div className="grid items-start gap-3 md:grid-cols-3">
        {field("limit", `Credit limit (${sym})`, { inputMode: "decimal", onBlur: regroup("limit") })}
        {field("statementDay", "Statement day", { ...day, hint: "Day of the month" })}
        {field("dueDay", "Due day", { ...day, hint: "Earlier than the statement day: the next month" })}
      </div>
      {!c && field("openingOwed", `Owed now (${sym})`, { inputMode: "decimal", placeholder: "0", onBlur: regroup("openingOwed"), hint: "What you owe today, including unbilled purchases. Not posted to any account." })}
      <Footer pending={pending} label={c ? "Save card" : "Add card"} />
    </form>
  )
}

// ---------------------------------------------------------------------------
// Enter a statement
// ---------------------------------------------------------------------------

export function StatementForm({ item, today, categories, onDone }: { item: CardItem; today: string; categories: { id: string; name: string }[]; onDone: () => void }) {
  const [requestKey] = useState(newRequestKey)
  const { card } = item
  const startDate = item.statementToAdd ?? latestStatementCycle(card.statementDay, today).statementDate
  const emis = (date: string) => minorToGroupedInputString(emisInCycle(item.linkedEmis, date, card.statementDay), card.currency)
  const [values, setValues] = useState({
    statementDate: startDate,
    dueDate: cardDueDate(startDate, card.dueDay),
    total: "",
    minimum: "",
    emiIncluded: item.linkedEmis.length ? emis(startDate) : "",
    differenceCategoryId: "",
  })
  const [recordDifference, setRecordDifference] = useState(false)
  const { errors, formError, pending, submit } = useSubmit(onDone)
  const sym = currencySymbol(card.currency)
  const set = (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [name]: e.target.value }))
  const regroup = (name: "total" | "minimum" | "emiIncluded") => () => setValues((v) => ({ ...v, [name]: regroupAmountInput(v[name], card.currency) }))
  const amount = (name: "total" | "minimum" | "emiIncluded", label: string, props: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField name={name} label={label} value={values[name]} error={errors[name]} onChange={set(name)} onBlur={regroup(name)} inputMode="decimal" autoComplete="off" {...props} />
  )
  const total = parseAmount(values.total || "0", card.currency, { allowZero: true })
  const emi = parseAmount(values.emiIncluded || "0", card.currency, { allowZero: true })
  const bill = total.ok && emi.ok && emi.minor <= total.minor ? addMinor(total.minor, -emi.minor) : null
  return (
    <form
      noValidate
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(() =>
          enterStatementAction({ ...values, cardId: card.id, differenceCategoryId: recordDifference ? values.differenceCategoryId : "", idempotencyKey: requestKey }),
        )
      }}
    >
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <div className="grid items-start gap-3 md:grid-cols-2">
        <TextField
          name="statementDate"
          type="date"
          label="Statement date"
          max={today}
          value={values.statementDate}
          error={errors.statementDate}
          hint={inWords(values.statementDate)}
          onChange={(e) => {
            const date = e.target.value
            // The due date and EMIs follow the statement date until changed by hand.
            setValues((v) => ({
              ...v,
              statementDate: date,
              dueDate: date && v.dueDate === cardDueDate(v.statementDate, card.dueDay) ? cardDueDate(date, card.dueDay) : v.dueDate,
              emiIncluded: date && item.linkedEmis.length && v.emiIncluded === emis(v.statementDate) ? emis(date) : v.emiIncluded,
            }))
          }}
        />
        <TextField name="dueDate" type="date" label="Due date" min={values.statementDate} value={values.dueDate} error={errors.dueDate} hint={inWords(values.dueDate)} onChange={set("dueDate")} />
      </div>
      <div className="grid items-start gap-3 md:grid-cols-3">
        {amount("total", `Total due (${sym})`)}
        {amount("minimum", `Minimum due (${sym})`, { placeholder: "0" })}
        {amount("emiIncluded", `Card EMIs included (${sym})`, {
          placeholder: "0",
          hint: item.linkedEmis.length ? `${CARD_EMI_NOTE}. Filled from linked card EMIs.` : `${CARD_EMI_NOTE}.`,
        })}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-(--color-ink)" checked={recordDifference} onChange={(e) => setRecordDifference(e.target.checked)} />
        <span>
          <span className="font-semibold">Record the difference as an expense</span>
          <span className="block text-xs text-muted-foreground">
            If the bill is more than the purchases you&apos;ve recorded up to the statement date, the gap is added as one expense on the card, dated the statement.
          </span>
        </span>
      </label>
      {recordDifference && (
        <SelectField name="differenceCategoryId" label="Category for the difference" value={values.differenceCategoryId} error={errors.differenceCategoryId} onChange={set("differenceCategoryId")}>
          <option value="">Choose a category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      )}
      <Footer pending={pending} label="Save statement">
        {bill !== null && (
          <>
            <span className="font-semibold">Bill </span>
            <span className="font-heading text-lg font-bold">{money(bill, card.currency)}</span>
          </>
        )}
      </Footer>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Pay a card: the pending bill (full, minimum, custom) or any other amount
// ---------------------------------------------------------------------------

type PayMode = "full" | "minimum" | "custom" | "other"

export function CardPayForm({
  item,
  accounts,
  today,
  payment,
  onDone,
}: {
  item: CardItem
  accounts: readonly PayingAccount[]
  today: string
  /** Changing this payment (its transfer is voided and posted again). */
  payment?: LiabilityPaymentLine
  onDone: () => void
}) {
  const [requestKey] = useState(newRequestKey)
  const { card } = item
  const c = card.currency
  const eligible = accounts.filter((a) => a.currency === c)
  const bill = item.pendingBill
  const minimumLeft = bill?.minimumDueMinor ? Math.min(Math.max(addMinor(bill.minimumDueMinor, -bill.paidMinor), 0), item.owedMinor) : 0
  const options: { value: PayMode; label: string }[] = payment
    ? []
    : bill
      ? [
          { value: "full", label: `Full ${money(bill.payDefaultMinor, c)}` },
          ...(minimumLeft > 0 ? [{ value: "minimum" as const, label: `Minimum ${money(minimumLeft, c)}` }] : []),
          { value: "custom", label: "Custom" },
          { value: "other", label: "Other amount" },
        ]
      : []
  const [mode, setMode] = useState<PayMode>(payment ? (payment.kind === "bill" ? "custom" : "other") : bill ? "full" : "other")
  const preset = (m: PayMode) => (m === "full" && bill ? bill.payDefaultMinor : m === "minimum" ? minimumLeft : null)
  const [values, setValues] = useState({
    accountId: payment?.accountId ?? bill?.plannedAccountId ?? eligible[0]?.id ?? "",
    paidOn: payment?.paidOn ?? today,
    amount: payment ? minorToGroupedInputString(payment.principalMinor, c) : bill ? minorToGroupedInputString(bill.payDefaultMinor, c) : "",
  })
  const { errors, formError, serverShort, setServerShort, pending, submit } = useSubmit(onDone)
  const sym = currencySymbol(c)

  const parsed = parseAmount(values.amount, c)
  const amountMinor = preset(mode) ?? (parsed.ok ? parsed.minor : null)
  const account = eligible.find((a) => a.id === values.accountId)
  const available = account ? account.balanceMinor + (payment && payment.accountId === account.id ? payment.principalMinor : 0) : null
  const short = amountMinor !== null && available !== null ? shortfallMinor(available, amountMinor) : 0
  const warning = serverShort ?? (short > 0 && account ? shortfallMessage(short, account.name, c, "this card") : null)
  const viaBill = payment ? payment.kind === "bill" : mode !== "other"

  function save(allowShortfall: boolean) {
    const amount = amountMinor !== null ? minorToGroupedInputString(amountMinor, c) : values.amount
    const common = { accountId: values.accountId, paidOn: values.paidOn, allowShortfall: allowShortfall ? "true" : "", idempotencyKey: requestKey }
    void submit(() => {
      if (payment) {
        return payment.kind === "bill"
          ? editDuePaymentAction({ ...common, paymentId: payment.id, principal: amount, interest: "", fees: "" })
          : editLiabilityPaymentAction({ ...common, paymentId: payment.id, amount })
      }
      return viaBill && bill
        ? payDueItemAction({ ...common, dueItemId: bill.id, principal: amount, interest: "", fees: "" })
        : payCardAction({ ...common, cardId: card.id, amount })
    })
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
      {options.length > 0 && (
        <Choice
          name="mode"
          legend="Pay"
          value={mode}
          options={options}
          grid
          onChange={(v) => {
            setServerShort(null)
            setMode(v)
          }}
          hint={
            mode === "other"
              ? "Any amount up to what you owe. The bill stays open until payments from its statement date cover it."
              : "Paying the bill closes it; anything not paid stays owed on the card."
          }
        />
      )}
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
      <div className="grid items-start gap-3 md:grid-cols-2">
        <TextField name="paidOn" type="date" label="Paid on" max={today} value={values.paidOn} error={errors.paidOn} hint={inWords(values.paidOn)} onChange={(e) => setValues((v) => ({ ...v, paidOn: e.target.value }))} />
        {preset(mode) === null && (
          <TextField
            name="amount"
            label={`Amount (${sym})`}
            inputMode="decimal"
            autoComplete="off"
            value={values.amount}
            error={errors.amount ?? errors.principal}
            hint={`You owe ${money(item.owedMinor, c)} on this card`}
            onChange={(e) => {
              setServerShort(null)
              setValues((v) => ({ ...v, amount: e.target.value }))
            }}
            onBlur={() => setValues((v) => ({ ...v, amount: regroupAmountInput(v.amount, c) }))}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">A card payment moves money to the card. It isn&apos;t an expense: the purchases already are.</p>
      {warning && <ShortfallWarning warning={warning} pending={pending} onPayAnyway={() => save(true)} />}
      <Footer pending={pending} label={payment ? "Save payment" : "Pay"}>
        {amountMinor !== null && (
          <>
            <span className="font-semibold">Paying </span>
            <span className="font-heading text-lg font-bold">{money(amountMinor, c)}</span>
          </>
        )}
      </Footer>
    </form>
  )
}

/** "Will pay later" for a card bill: a date and account; the bill stays pending. */
export function PlanBillForm({ item, accounts, today, onDone }: { item: CardItem; accounts: readonly PayingAccount[]; today: string; onDone: () => void }) {
  const bill = item.pendingBill
  const eligible = accounts.filter((a) => a.currency === item.card.currency)
  const [values, setValues] = useState({ accountId: bill?.plannedAccountId ?? eligible[0]?.id ?? "", plannedOn: bill?.plannedOn ?? today })
  const { errors, formError, pending, submit } = useSubmit(onDone)
  if (!bill) return null
  if (eligible.length === 0) return <NoAccounts />
  return (
    <form
      noValidate
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(() => planDueItemAction({ dueItemId: bill.id, ...values }))
      }}
    >
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <AccountPicker label="Will pay from" accounts={eligible} value={values.accountId} error={errors.accountId} onChange={(id) => setValues((v) => ({ ...v, accountId: id }))} />
      <TextField name="plannedOn" type="date" label="Pay on" min={today} value={values.plannedOn} error={errors.plannedOn} hint={inWords(values.plannedOn)} onChange={(e) => setValues((v) => ({ ...v, plannedOn: e.target.value }))} />
      {bill.plannedOn && (
        <div>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void submit(() => clearDuePlanAction({ dueItemId: bill.id }))}>
            Remove plan
          </Button>
        </div>
      )}
      <Footer pending={pending} label="Save plan" />
    </form>
  )
}

/** Link a credit card EMI (a loan) to its card, so its EMIs fill "EMIs included" on statements. */
export function LinkEmiForm({ loan, cards, onDone }: { loan: LoanItem; cards: CardItem[]; onDone: () => void }) {
  const [cardId, setCardId] = useState(loan.loan.cardId ?? "")
  const { formError, pending, submit } = useSubmit(onDone)
  return (
    <form
      noValidate
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(() => linkCardEmiAction({ loanId: loan.loan.id, cardId: cardId || null }))
      }}
    >
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <SelectField name="cardId" label="Card" value={cardId} onChange={(e) => setCardId(e.target.value)} hint={CARD_EMI_NOTE}>
        <option value="">Not linked</option>
        {cards
          .filter((c) => c.card.currency === loan.loan.currency)
          .map((c) => (
            <option key={c.card.id} value={c.card.id}>
              {c.name}
            </option>
          ))}
      </SelectField>
      <Footer pending={pending} label="Save" />
    </form>
  )
}

// ---------------------------------------------------------------------------
// Borrowing: add, repay, due date
// ---------------------------------------------------------------------------

export function BorrowingForm({ accounts, today, currency, onDone }: { accounts: readonly PayingAccount[]; today: string; currency: string; onDone: () => void }) {
  const [requestKey] = useState(newRequestKey)
  const eligible = accounts.filter((a) => a.currency === currency)
  const [values, setValues] = useState({
    lender: "",
    amount: "",
    received: eligible.length ? "into_account" : "earlier",
    accountId: eligible[0]?.id ?? "",
    receivedOn: today,
    dueDate: "",
  })
  const { errors, formError, pending, submit } = useSubmit(onDone)
  const sym = currencySymbol(currency)
  const set = (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [name]: e.target.value }))
  const into = values.received === "into_account"
  return (
    <form
      noValidate
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(() => addBorrowingAction({ ...values, accountId: into ? values.accountId : "", receivedOn: into ? values.receivedOn : "", idempotencyKey: requestKey }))
      }}
    >
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <div className="grid items-start gap-3 md:grid-cols-2">
        <TextField name="lender" label="Borrowed from" placeholder="e.g. Ravi" maxLength={80} value={values.lender} error={errors.lender} onChange={set("lender")} autoComplete="off" hint="A name only, no numbers" />
        <TextField
          name="amount"
          label={`Amount (${sym})`}
          inputMode="decimal"
          autoComplete="off"
          value={values.amount}
          error={errors.amount}
          onChange={set("amount")}
          onBlur={() => setValues((v) => ({ ...v, amount: regroupAmountInput(v.amount, currency) }))}
        />
      </div>
      <Choice name="received" legend="The money" value={values.received} options={BORROWING_RECEIVED_OPTIONS} error={errors.received} onChange={(v) => setValues((s) => ({ ...s, received: v }))} grid />
      {into &&
        (eligible.length === 0 ? (
          <FormMessage tone="info">{NO_ACCOUNTS}</FormMessage>
        ) : (
          <div className="grid items-start gap-3 md:grid-cols-2">
            <AccountPicker label="Received into" accounts={eligible} value={values.accountId} error={errors.accountId} onChange={(id) => setValues((v) => ({ ...v, accountId: id }))} />
            <TextField name="receivedOn" type="date" label="Received on" max={today} value={values.receivedOn} error={errors.receivedOn} hint={inWords(values.receivedOn)} onChange={set("receivedOn")} />
          </div>
        ))}
      <TextField
        name="dueDate"
        type="date"
        label="Due date (optional)"
        min={into ? values.receivedOn : today}
        value={values.dueDate}
        error={errors.dueDate}
        hint={inWords(values.dueDate) ?? "We remind you the day before and on the day"}
        onChange={set("dueDate")}
      />
      <Footer pending={pending} label="Add borrowing" />
    </form>
  )
}

export function RepayForm({
  item,
  accounts,
  today,
  payment,
  onDone,
}: {
  item: BorrowingItem
  accounts: readonly PayingAccount[]
  today: string
  payment?: LiabilityPaymentLine
  onDone: () => void
}) {
  const [requestKey] = useState(newRequestKey)
  const c = item.borrowing.currency
  const eligible = accounts.filter((a) => a.currency === c)
  const [values, setValues] = useState({
    accountId: payment?.accountId ?? item.due?.plannedAccountId ?? eligible[0]?.id ?? "",
    paidOn: payment?.paidOn ?? today,
    principal: minorToGroupedInputString(payment?.principalMinor ?? item.owedMinor, c),
    interest: payment && payment.interestMinor > 0 ? minorToGroupedInputString(payment.interestMinor, c) : "",
  })
  const { errors, formError, serverShort, setServerShort, pending, submit } = useSubmit(onDone)
  const sym = currencySymbol(c)
  const parts = [values.principal, values.interest].map((v) => parseAmount(v || "0", c, { allowZero: true }))
  const total = parts.every((p) => p.ok) ? addMinor(...parts.map((p) => (p.ok ? p.minor : 0))) : null
  const account = eligible.find((a) => a.id === values.accountId)
  const back = payment && account && payment.accountId === account.id ? addMinor(payment.principalMinor, payment.interestMinor) : 0
  const short = total !== null && account ? shortfallMinor(account.balanceMinor + back, total) : 0
  const warning = serverShort ?? (short > 0 && account ? shortfallMessage(short, account.name, c, "this repayment") : null)
  const set = (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setServerShort(null)
    setValues((v) => ({ ...v, [name]: e.target.value }))
  }
  const regroup = (name: "principal" | "interest") => () => setValues((v) => ({ ...v, [name]: regroupAmountInput(v[name], c) }))
  function save(allowShortfall: boolean) {
    const input = { ...values, allowShortfall: allowShortfall ? "true" : "", idempotencyKey: requestKey }
    void submit(() => (payment ? editLiabilityPaymentAction({ ...input, paymentId: payment.id }) : repayBorrowingAction({ ...input, borrowingId: item.borrowing.id })))
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
          label={`Repaid (${sym})`}
          inputMode="decimal"
          autoComplete="off"
          value={values.principal}
          error={errors.principal}
          hint={`Still owed ${money(item.owedMinor + (payment?.principalMinor ?? 0), c)}`}
          onChange={set("principal")}
          onBlur={regroup("principal")}
        />
        <TextField name="interest" label={`Interest (${sym}, optional)`} inputMode="decimal" placeholder="0" autoComplete="off" value={values.interest} error={errors.interest} onChange={set("interest")} onBlur={regroup("interest")} />
      </div>
      <p className="text-xs text-muted-foreground">What you repay moves to {item.name}&apos;s balance; interest is an expense.</p>
      {warning && <ShortfallWarning warning={warning} pending={pending} onPayAnyway={() => save(true)} />}
      <Footer pending={pending} label="Save repayment">
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

export function DueDateForm({ item, today, onDone }: { item: BorrowingItem; today: string; onDone: () => void }) {
  const [dueDate, setDueDate] = useState(item.due?.dueDate && item.due.dueDate >= today ? item.due.dueDate : "")
  const { errors, formError, pending, submit } = useSubmit(onDone)
  return (
    <form
      noValidate
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(() => setBorrowingDueDateAction({ borrowingId: item.borrowing.id, dueDate }))
      }}
    >
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      {item.due && <p className="text-sm text-muted-foreground">Now due {fullDate(item.due.dueDate)}.</p>}
      <TextField name="dueDate" type="date" label="New due date" min={today} value={dueDate} error={errors.dueDate} hint={inWords(dueDate) ?? "Leave empty to remove the due date"} onChange={(e) => setDueDate(e.target.value)} />
      <Footer pending={pending} label={dueDate ? "Save due date" : item.due ? "Remove due date" : "Save"} />
    </form>
  )
}
