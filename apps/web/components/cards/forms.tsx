"use client"

import type * as React from "react"
import { useState } from "react"
import { type BorrowingDue, type BorrowingItem, type CardItem, type CardWriteResult, type LiabilityPaymentLine, type LoanItem, type WriteResult, newRequestKey } from "@fin-creador/api"
import {
  type BorrowingReturnPlan,
  addMinor,
  borrowingSchedule,
  cardDueDate,
  emisInCycle,
  latestStatementCycle,
  minorToGroupedInputString,
  parseAmount,
  regroupAmountInput,
  shortfallMinor,
} from "@fin-creador/domain"
import {
  BORROWING_RECEIVED_OPTIONS,
  BORROWING_RELATIONSHIP_OPTIONS,
  BORROWING_RETURN_PLAN_OPTIONS,
  CARD_EMI_NOTE,
  CARD_ISSUERS,
  CARD_PRODUCTS,
  type CardIssuer,
  type PayingAccount,
  shortfallMessage,
} from "@fin-creador/schemas"
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
  editBorrowingAction,
  repayBorrowingAction,
  setBorrowingReturnPlanAction,
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
// its details and return plan, and repay it (one instalment at a time when planned). Every check is repeated by the shared schemas on the
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

function AccountPicker({
  label,
  accounts,
  value,
  error,
  onChange,
  name = "accountId",
  hint = "Bank, cash and other accounts, with balances",
}: {
  label: string
  accounts: readonly PayingAccount[]
  value: string
  error?: string
  onChange: (id: string) => void
  name?: string
  hint?: string
}) {
  return (
    <SelectField name={name} label={label} value={value} error={error || undefined} onChange={(e) => onChange(e.target.value)} hint={hint}>
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

/** Dialogs with many fields: the body scrolls, the footer stays (fits a 720px-high window). */
export const TALL_DIALOG = "flex max-h-dvh flex-col md:max-h-[calc(100dvh-2rem)] md:max-w-[640px]"

function Scroll({ children }: { children: React.ReactNode }) {
  return <div className="-mx-1 grid min-h-0 flex-1 content-start gap-3.5 overflow-y-auto px-1 pb-3">{children}</div>
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 accent-(--color-ink)" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Add or edit a card
// ---------------------------------------------------------------------------

const OTHER = "__other"
const isIssuer = (v: string): v is CardIssuer => (CARD_ISSUERS as readonly string[]).includes(v)

export function CardForm({ card, currency, onDone }: { card?: CardItem; currency: string; onDone: () => void }) {
  const [requestKey] = useState(newRequestKey)
  const c = card?.card
  const listedIssuer = c && isIssuer(c.issuer) ? c.issuer : null
  const listedProduct = c?.product && !c.productOther && listedIssuer && CARD_PRODUCTS[listedIssuer].includes(c.product) ? c.product : null
  const [issuerChoice, setIssuerChoice] = useState<string>(c ? (listedIssuer ?? OTHER) : "")
  const [productChoice, setProductChoice] = useState<string>(c ? (listedProduct ?? (c.product ? OTHER : "")) : "")
  const [values, setValues] = useState({
    issuer: c && !listedIssuer ? c.issuer : "",
    product: c?.product && !listedProduct ? c.product : "",
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
  const issuer = issuerChoice === OTHER ? values.issuer : issuerChoice
  const products = isIssuer(issuerChoice) ? CARD_PRODUCTS[issuerChoice] : []
  // A typed issuer has no list: its card can only be typed.
  const productOther = issuerChoice === OTHER || productChoice === OTHER
  const product = productOther ? values.product : productChoice
  const typedName = values.product.trim().replace(/\s+/g, " ")
  return (
    <form
      noValidate
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        const input = { ...values, issuer, product, productOther: productOther && product ? "true" : "" }
        void submit((): Promise<CardWriteResult> => (c ? editCardAction({ ...input, cardId: c.id }) : addCardAction({ ...input, idempotencyKey: requestKey })))
      }}
    >
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <div className="grid items-start gap-3 md:grid-cols-2">
        <SelectField
          name="issuerChoice"
          label="Card issuer"
          value={issuerChoice}
          error={issuerChoice === OTHER ? undefined : errors.issuer}
          onChange={(e) => {
            setIssuerChoice(e.target.value)
            setProductChoice("")
          }}
        >
          <option value="">Choose the issuer</option>
          {CARD_ISSUERS.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
          <option value={OTHER}>Other</option>
        </SelectField>
        {issuerChoice === OTHER
          ? field("issuer", "Issuer name", { maxLength: 80, placeholder: "e.g. IndusInd Bank", hint: "No digits" })
          : (
            <SelectField
              name="productChoice"
              label="Card"
              value={productChoice}
              disabled={!issuerChoice}
              error={productChoice === OTHER ? undefined : errors.product}
              hint={issuerChoice ? undefined : "Choose the issuer first"}
              onChange={(e) => setProductChoice(e.target.value)}
            >
              <option value="">Choose your card</option>
              {products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value={OTHER}>Other</option>
            </SelectField>
          )}
      </div>
      {productOther &&
        field("product", "Card name", {
          maxLength: 80,
          placeholder: "e.g. Platinum",
          hint: typedName && issuer.trim() ? `Shown as “${issuer.trim()} ${typedName}”` : "As on the card, without numbers",
        })}
      {field("nickname", "Label if you hold two of the same card (optional)", { maxLength: 40, placeholder: "e.g. Travel", hint: "No digits" })}
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
// Borrowing: add, details, return plan, repay
// ---------------------------------------------------------------------------

type PlanValues = { sameAsBorrowed: boolean; amountToReturn: string; returnOn: string; returnPlan: string; instalments: string; payFromAccountId: string }

const planInput = (v: PlanValues) => ({
  sameAsBorrowed: v.sameAsBorrowed ? "true" : "",
  amountToReturn: v.sameAsBorrowed ? "" : v.amountToReturn,
  returnOn: v.returnOn,
  returnPlan: v.returnOn ? v.returnPlan : "",
  instalments: v.returnOn && v.returnPlan === "instalments" ? v.instalments : "",
  payFromAccountId: v.returnOn ? v.payFromAccountId : "",
})

const NOTHING_DEDUCTED = "Nothing is deducted until you confirm Paid."

/**
 * How much to return ("Same as borrowed", or more: the extra is interest) and, once a return
 * date is entered, how (one-time settlement or monthly instalments) and from which account,
 * with the schedule it makes.
 */
function ReturnPlanFields({
  values,
  setValues,
  errors,
  borrowedMinor,
  currency,
  accounts,
  minDate,
}: {
  values: PlanValues
  setValues: React.Dispatch<React.SetStateAction<PlanValues>>
  errors: Record<string, string>
  borrowedMinor: number | null
  currency: string
  accounts: readonly PayingAccount[]
  minDate: string
}) {
  const sym = currencySymbol(currency)
  const total = values.sameAsBorrowed ? borrowedMinor : (() => {
    const a = parseAmount(values.amountToReturn, currency)
    return a.ok ? a.minor : null
  })()
  const extra = total !== null && borrowedMinor !== null && total > borrowedMinor ? total - borrowedMinor : 0
  const instalments = values.returnPlan === "instalments"
  let schedule: ReturnType<typeof borrowingSchedule> = []
  if (values.returnOn && total !== null && borrowedMinor !== null && (values.returnPlan === "once" || values.returnPlan === "instalments")) {
    try {
      schedule = borrowingSchedule({
        totalMinor: total,
        borrowedMinor,
        returnOn: values.returnOn,
        returnPlan: values.returnPlan as BorrowingReturnPlan,
        instalmentCount: instalments ? Number(values.instalments) : null,
      })
    } catch {
      schedule = []
    }
  }
  return (
    <>
      <Check
        checked={values.sameAsBorrowed}
        onChange={(checked) => setValues((v) => ({ ...v, sameAsBorrowed: checked }))}
        label="Return the same as borrowed"
        hint="Untick if you agreed to return more (interest or a charge)"
      />
      {!values.sameAsBorrowed && (
        <TextField
          name="amountToReturn"
          label={`How much to return (${sym})`}
          inputMode="decimal"
          autoComplete="off"
          value={values.amountToReturn}
          error={errors.amountToReturn}
          hint={extra > 0 ? `Interest or charges ${money(extra, currency)}, posted as an expense when you repay` : "At least the amount borrowed"}
          onChange={(e) => setValues((v) => ({ ...v, amountToReturn: e.target.value }))}
          onBlur={() => setValues((v) => ({ ...v, amountToReturn: regroupAmountInput(v.amountToReturn, currency) }))}
        />
      )}
      <TextField
        name="returnOn"
        type="date"
        label={instalments && values.returnOn ? "First instalment on" : "Return date (optional)"}
        min={minDate}
        value={values.returnOn}
        error={errors.returnOn}
        hint={inWords(values.returnOn) ?? "Reminders follow it"}
        onChange={(e) => setValues((v) => ({ ...v, returnOn: e.target.value }))}
      />
      {values.returnOn && (
        <>
          <Choice
            name="returnPlan"
            legend="How will you return it?"
            value={values.returnPlan}
            options={BORROWING_RETURN_PLAN_OPTIONS}
            error={errors.returnPlan}
            onChange={(v) => setValues((s) => ({ ...s, returnPlan: v }))}
          />
          <div className="grid items-start gap-3 md:grid-cols-2">
            {instalments && (
              <TextField
                name="instalments"
                label="Number of instalments"
                inputMode="numeric"
                maxLength={2}
                placeholder="2 to 60"
                autoComplete="off"
                value={values.instalments}
                error={errors.instalments}
                hint="Monthly, from the first instalment date"
                onChange={(e) => setValues((v) => ({ ...v, instalments: e.target.value }))}
              />
            )}
            <AccountPicker
              name="payFromAccountId"
              label="Return from"
              hint="Bank, cash or other account"
              accounts={accounts}
              value={values.payFromAccountId}
              error={errors.payFromAccountId}
              onChange={(id) => setValues((v) => ({ ...v, payFromAccountId: id }))}
            />
          </div>
          {schedule.length > 0 && (
            <div className="grid gap-1">
              <h4 className="text-xs font-semibold text-muted-foreground">{instalments ? `${schedule.length} instalments` : "One-time settlement"}</h4>
              <ul aria-label="Return schedule" className="max-h-36 overflow-y-auto rounded-lg border border-line bg-surface px-3">
                {schedule.map((i) => (
                  <li key={i.seq} className="flex justify-between gap-3 border-b border-line py-1 text-sm tabular-nums last:border-b-0">
                    <span>{fullDate(i.dueDate)}</span>
                    <span>
                      <span className="font-semibold">{money(i.amountMinor, currency)}</span>
                      {i.interestMinor > 0 && <span className="text-xs text-muted-foreground"> · interest {money(i.interestMinor, currency)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{NOTHING_DEDUCTED}</p>
        </>
      )}
    </>
  )
}

function DetailsFields({
  values,
  set,
  errors,
}: {
  values: { lender: string; relationship: string; reason: string }
  set: (name: "lender" | "relationship" | "reason") => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void
  errors: Record<string, string>
}) {
  return (
    <>
      <div className="grid items-start gap-3 md:grid-cols-2">
        <TextField name="lender" label="Borrowed from" placeholder="e.g. Ravi" maxLength={80} value={values.lender} error={errors.lender} onChange={set("lender")} autoComplete="off" hint="A name only, no digits" />
        <SelectField name="relationship" label="Who they are to you" value={values.relationship} error={errors.relationship} onChange={set("relationship")}>
          <option value="">Choose</option>
          {BORROWING_RELATIONSHIP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField name="reason" label="Borrowed for (optional)" placeholder="e.g. Bike repair" maxLength={80} value={values.reason} error={errors.reason} onChange={set("reason")} autoComplete="off" hint="A few words; no account or card numbers" />
    </>
  )
}

export function BorrowingForm({ accounts, today, currency, onDone }: { accounts: readonly PayingAccount[]; today: string; currency: string; onDone: () => void }) {
  const [requestKey] = useState(newRequestKey)
  const eligible = accounts.filter((a) => a.currency === currency)
  const [values, setValues] = useState({
    lender: "",
    relationship: "",
    reason: "",
    amount: "",
    received: eligible.length ? "into_account" : "earlier",
    accountId: eligible[0]?.id ?? "",
    receivedOn: today,
  })
  const [plan, setPlan] = useState<PlanValues>({ sameAsBorrowed: true, amountToReturn: "", returnOn: "", returnPlan: "", instalments: "", payFromAccountId: eligible[0]?.id ?? "" })
  const { errors, formError, pending, submit } = useSubmit(onDone)
  const sym = currencySymbol(currency)
  const set = (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [name]: e.target.value }))
  const into = values.received === "into_account"
  const amount = parseAmount(values.amount, currency)
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(() =>
          addBorrowingAction({ ...values, ...planInput(plan), accountId: into ? values.accountId : "", receivedOn: into ? values.receivedOn : "", idempotencyKey: requestKey }),
        )
      }}
    >
      <Scroll>
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
        <DetailsFields values={values} set={set} errors={errors} />
        <TextField
          name="amount"
          label={`Amount borrowed (${sym})`}
          inputMode="decimal"
          autoComplete="off"
          value={values.amount}
          error={errors.amount}
          onChange={set("amount")}
          onBlur={() => setValues((v) => ({ ...v, amount: regroupAmountInput(v.amount, currency) }))}
        />
        <Choice name="received" legend="The money" value={values.received} options={BORROWING_RECEIVED_OPTIONS} error={errors.received} onChange={(v) => setValues((s) => ({ ...s, received: v }))} grid />
        {into &&
          (eligible.length === 0 ? (
            <FormMessage tone="info">{NO_ACCOUNTS}</FormMessage>
          ) : (
            <div className="grid items-start gap-3 md:grid-cols-2">
              <AccountPicker label="Received into" hint="Bank, Cash in hand or other account" accounts={eligible} value={values.accountId} error={errors.accountId} onChange={(id) => setValues((v) => ({ ...v, accountId: id }))} />
              <TextField name="receivedOn" type="date" label="Received on" max={today} value={values.receivedOn} error={errors.receivedOn} hint={inWords(values.receivedOn)} onChange={set("receivedOn")} />
            </div>
          ))}
        <ReturnPlanFields
          values={plan}
          setValues={setPlan}
          errors={errors}
          borrowedMinor={amount.ok ? amount.minor : null}
          currency={currency}
          accounts={eligible}
          minDate={into ? values.receivedOn : today}
        />
      </Scroll>
      <Footer pending={pending} label="Add borrowing" />
    </form>
  )
}

/** Who it is from, who they are to you and what it was for. */
export function BorrowingDetailsForm({ item, onDone }: { item: BorrowingItem; onDone: () => void }) {
  const b = item.borrowing
  const [values, setValues] = useState({ lender: b.lender, relationship: b.relationship ?? "", reason: b.reason ?? "" })
  const { errors, formError, pending, submit } = useSubmit(onDone)
  const set = (name: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [name]: e.target.value }))
  return (
    <form
      noValidate
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(() => editBorrowingAction({ ...values, borrowingId: b.id }))
      }}
    >
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <DetailsFields values={values} set={set} errors={errors} />
      <Footer pending={pending} label="Save details" />
    </form>
  )
}

/** How much to return and the return plan; the due items are rebuilt. */
export function ReturnPlanForm({ item, accounts, today, onDone }: { item: BorrowingItem; accounts: readonly PayingAccount[]; today: string; onDone: () => void }) {
  const b = item.borrowing
  const eligible = accounts.filter((a) => a.currency === b.currency)
  const keptAccount = b.repayFromAccountId && eligible.some((a) => a.id === b.repayFromAccountId) ? b.repayFromAccountId : ""
  const [plan, setPlan] = useState<PlanValues>({
    sameAsBorrowed: b.amountToReturnMinor === b.borrowedMinor,
    amountToReturn: b.amountToReturnMinor === b.borrowedMinor ? "" : minorToGroupedInputString(b.amountToReturnMinor, b.currency),
    returnOn: b.returnOn ?? "",
    returnPlan: b.returnPlan ?? "",
    instalments: b.instalmentCount ? String(b.instalmentCount) : "",
    payFromAccountId: keptAccount || (eligible[0]?.id ?? ""),
  })
  const { errors, formError, pending, submit } = useSubmit(onDone)
  const planned = item.dues.filter((d) => d.status === "pending" && d.plannedOn).length
  // The date already set may stay even when it is past; a new one is today or later.
  const minDate = b.returnOn && b.returnOn < today ? b.returnOn : today
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(() => setBorrowingReturnPlanAction({ ...planInput(plan), borrowingId: b.id }))
      }}
    >
      <Scroll>
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
        <p className="text-sm text-muted-foreground">
          Borrowed {money(b.borrowedMinor, b.currency)}; repaid so far {money(item.repaidMinor, b.currency)}. Repayments already made still count, the earliest instalment first.
        </p>
        {item.dues.length > 0 && (
          <FormMessage tone={planned > 0 ? "error" : "info"}>
            {planned > 0
              ? `Saving replaces the schedule: the ${planned === 1 ? "“Will pay later” plan" : `${planned} “Will pay later” plans`} on pending instalments will be dropped.`
              : "Saving replaces the schedule; any “Will pay later” plan on a pending instalment is dropped."}
          </FormMessage>
        )}
        {!keptAccount && b.repayFromAccountId && <FormMessage tone="info">The account it was to be returned from is archived or gone. Choose another.</FormMessage>}
        <ReturnPlanFields values={plan} setValues={setPlan} errors={errors} borrowedMinor={b.borrowedMinor} currency={b.currency} accounts={eligible} minDate={minDate} />
      </Scroll>
      <Footer pending={pending} label={plan.returnOn ? "Save return plan" : b.returnOn ? "Remove return date" : "Save"} />
    </form>
  )
}

/**
 * Repay: any amount, or one instalment (`due`), prefilled with its account and what is left of
 * it split into principal and interest. Everything stays editable.
 */
export function RepayForm({
  item,
  due,
  accounts,
  today,
  payment,
  onDone,
}: {
  item: BorrowingItem
  due?: BorrowingDue
  accounts: readonly PayingAccount[]
  today: string
  payment?: LiabilityPaymentLine
  onDone: () => void
}) {
  const [requestKey] = useState(newRequestKey)
  const c = item.borrowing.currency
  const eligible = accounts.filter((a) => a.currency === c)
  const usable = (id: string | null | undefined) => (id && eligible.some((a) => a.id === id) ? id : null)
  const wanted = due ? (due.plannedAccountId ?? due.payFromAccountId) : null
  const gone = !payment && wanted !== null && !usable(wanted)
  const [values, setValues] = useState({
    accountId: payment?.accountId ?? (due ? (usable(wanted) ?? "") : (usable(item.due?.plannedAccountId) ?? eligible[0]?.id ?? "")),
    paidOn: payment?.paidOn ?? today,
    principal: minorToGroupedInputString(payment?.principalMinor ?? (due ? due.remainingPrincipalMinor : item.owedMinor), c),
    interest: payment
      ? payment.interestMinor > 0
        ? minorToGroupedInputString(payment.interestMinor, c)
        : ""
      : due && due.remainingInterestMinor > 0
        ? minorToGroupedInputString(due.remainingInterestMinor, c)
        : "",
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
      {gone && <FormMessage tone="info">{due?.payFromAccountName ? `${due.payFromAccountName} is archived.` : "The planned account is gone."} Choose the account you paid from.</FormMessage>}
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
      <Footer pending={pending} label={payment ? "Save repayment" : "Paid"}>
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

/** "Will pay later" for one borrowing instalment: a date and account; it stays due. */
export function PlanBorrowingDueForm({ due, currency, accounts, today, onDone }: { due: BorrowingDue; currency: string; accounts: readonly PayingAccount[]; today: string; onDone: () => void }) {
  const eligible = accounts.filter((a) => a.currency === currency)
  const first = [due.plannedAccountId, due.payFromAccountId].find((id) => id && eligible.some((a) => a.id === id)) ?? eligible[0]?.id ?? ""
  const [values, setValues] = useState({ accountId: first, plannedOn: due.plannedOn ?? today })
  const { errors, formError, pending, submit } = useSubmit(onDone)
  if (eligible.length === 0) return <NoAccounts />
  return (
    <form
      noValidate
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(() => planDueItemAction({ dueItemId: due.id, ...values }))
      }}
    >
      {formError && <FormMessage tone="error">{formError}</FormMessage>}
      <AccountPicker label="Will pay from" accounts={eligible} value={values.accountId} error={errors.accountId} onChange={(id) => setValues((v) => ({ ...v, accountId: id }))} />
      <TextField name="plannedOn" type="date" label="Pay on" min={today} value={values.plannedOn} error={errors.plannedOn} hint={inWords(values.plannedOn)} onChange={(e) => setValues((v) => ({ ...v, plannedOn: e.target.value }))} />
      {due.plannedOn && (
        <div>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void submit(() => clearDuePlanAction({ dueItemId: due.id }))}>
            Remove plan
          </Button>
        </div>
      )}
      <Footer pending={pending} label="Save plan" />
    </form>
  )
}
