"use client"

import { useState } from "react"
import {
  BANK_LINE_TYPES,
  BANK_TYPE_LABELS,
  BANK_UNREADABLE,
  type BankImportAccount,
  type BankImportOptions,
  type BankLineType,
  type BankReview,
  type BankReviewLine,
  type LineSaveResult,
  REFUND_NOTE,
  bankCheckReasons,
  bankLineErrors,
  bankReviewKeys,
  bankReviewTotals,
  bankSaveBlockers,
  buildBankReview,
  canTickBank,
  offerPayeeLabel,
  setBankLineType,
} from "@fin-creador/api"
import { type BankLineSkipReason, parsePnbSavingsStatementText } from "@fin-creador/domain"
import { IMPORT_SAVE_CHUNK } from "@fin-creador/schemas"
import { bankImportMatchesAction, saveBankImportLinesAction } from "@/app/(app)/income/import/actions"
import { fullDate, money } from "@/components/transactions/display"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { FormMessage } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { PDF_READ_MESSAGES } from "@/lib/statements/pdf-reader"
import {
  CheckAlert,
  LineHead,
  type SaveOutcome,
  SkippedNotice,
  StatementFileSection,
  UnreadableNotice,
  lineText,
  saveInChunks,
  savedOutcome,
  useStatementReader,
} from "./statement-shared"

// Bank account statement import (Sprint 9b): read the PDF in the browser (PNB savings layout),
// then review it with the parts shared with card import. Each line gets a type: a debit starts
// ticked as an expense; a credit starts unticked until the person says what it is. Transfers post
// as transfers, card payments through the card payment path. Labelling a payee offers the same
// label on its other lines in this file (in memory only, a tick still needed). Long statements are
// shown 100 lines a page, with filters; Save sends the ticked lines in chunks, each saved on its own.

type BankReviewPhase = { review: BankReview }
type Context = { accountId: string; openingBalanceDate: string; today: string; currency: string }

const PAGE = 100

const SKIP_TEXT: Record<BankLineSkipReason, string> = {
  before_account: "Skipped: before the account's opening balance date",
  future: "Skipped: future date",
}

type Filter = "all" | "choice" | "ticked" | "duplicates"
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All lines" },
  { value: "choice", label: "Need a choice" },
  { value: "ticked", label: "Ticked" },
  { value: "duplicates", label: "Possible duplicates" },
]

export function BankStatementImport({ account, today, options }: { account: BankImportAccount; today: string; options: BankImportOptions }) {
  const context: Context = { accountId: account.id, openingBalanceDate: account.openingBalanceDate, today, currency: account.currency }
  const reader: ReturnType<typeof useStatementReader<BankReviewPhase>> = useStatementReader<BankReviewPhase>({
    onText: (): Promise<void> => review(),
    cannotRead: () => ({ step: "message", text: BANK_UNREADABLE, pnbOffer: false }),
    wrongPassword: PDF_READ_MESSAGES.wrong_password,
  })
  const { phase, setPhase, attemptRef } = reader

  async function review(): Promise<void> {
    const read = reader.readRef.current
    if (read === null) return
    const id = ++attemptRef.current
    const parse = parsePnbSavingsStatementText(read.text)
    if (parse.lines.length === 0 && parse.issues.length === 0) return void setPhase({ step: "message", text: BANK_UNREADABLE, pnbOffer: false })
    setPhase({ step: "matching" })
    const result = await bankImportMatchesAction({
      accountId: account.id,
      keys: bankReviewKeys(account.id, parse),
      from: parse.summary.from ?? today,
      to: parse.summary.to ?? today,
    }).catch(() => null)
    if (id !== attemptRef.current) return
    if (!result?.ok) return void setPhase({ step: "match_failed" })
    setPhase({ step: "review", review: buildBankReview(parse, result.matches, options, context, read.pageRowCounts, read.rowLayouts) })
  }

  return (
    <div className="grid gap-4">
      <StatementFileSection label={`Choose your ${account.institution} statement (PDF)`} reader={reader} onRetry={() => void review()} />
      {phase.step === "review" && (
        <BankReviewSection
          key={phase.review.lines.map((l) => l.key).join()}
          account={account}
          options={options}
          context={context}
          initial={phase.review}
        />
      )}
    </div>
  )
}

function BankReviewSection({ account, options, context, initial }: { account: BankImportAccount; options: BankImportOptions; context: Context; initial: BankReview }) {
  const [lines, setLines] = useState(initial.lines)
  const [checkConfirmed, setCheckConfirmed] = useState(false)
  const [bulkCategory, setBulkCategory] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [page, setPage] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<Record<string, LineSaveResult>>({})
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null)
  const c = account.currency
  const totals = bankReviewTotals(lines, c)
  const reasons = bankCheckReasons(initial.checks, initial.lines.map((l) => l.original), c)
  const blockers = bankSaveBlockers({ lines, checks: initial.checks }, options, context, checkConfirmed)

  /** Applies a change to line `i` (by the person); a type or target change offers that label to the payee's other lines. */
  const change = (i: number, patch: Partial<BankReviewLine>, label: boolean) =>
    setLines((ls) => {
      const next = ls.map((l, k) => (k === i ? { ...l, ...patch, ...(label ? { touched: true, suggested: false } : {}) } : l))
      return label ? offerPayeeLabel(next, i) : next
    })
  const setType = (i: number, type: BankLineType | "") =>
    setLines((ls) => offerPayeeLabel(ls.map((l, k) => (k === i ? setBankLineType(l, type, options) : l)), i))
  const applyBulk = () => {
    if (bulkCategory) setLines((ls) => ls.map((l) => (l.ticked && l.type === "expense" ? { ...l, categoryId: bulkCategory } : l)))
  }

  const shown = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      filter === "all"
        ? true
        : filter === "ticked"
          ? line.ticked
          : filter === "duplicates"
            ? line.status === "duplicate"
            : (line.status === "new" || line.status === "duplicate") && (line.type === "" || line.suggested),
    )
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const current = Math.min(page, pages - 1)
  const pageLines = shown.slice(current * PAGE, (current + 1) * PAGE)

  const save = async () => {
    setConfirming(false)
    setSaving(true)
    setOutcome(null)
    const ticked = lines.filter((l) => l.ticked)
    const { done, stopped } = await saveInChunks(
      ticked,
      IMPORT_SAVE_CHUNK,
      (chunk) =>
        saveBankImportLinesAction({
          accountId: account.id,
          lines: chunk.map((l) => ({
            original: l.original,
            date: l.date,
            amount: l.amount,
            type: l.type,
            categoryId: l.categoryId,
            otherAccountId: l.otherAccountId,
            cardId: l.cardId,
          })),
        }),
      (chunkResults) => {
        const byKey = new Map(chunkResults.map((r) => [r.key, r]))
        setResults((prev) => ({ ...prev, ...Object.fromEntries(byKey) }))
        setLines((ls) =>
          ls.map((l) => {
            const r = byKey.get(l.key)
            if (!r || r.status === "failed") return l
            return { ...l, ticked: false, status: r.status === "deleted" ? "deleted" : "imported" }
          }),
        )
        setOutcome({ tone: "info", text: `Saving… ${lineText(Object.keys(byKey).length)} more done.` })
      },
    )
    setOutcome(savedOutcome(ticked.length, done, stopped))
    setSaving(false)
  }

  const tickedLines = lines.filter((l) => l.ticked)
  const transfers = tickedLines.filter((l) => l.type === "transfer").length
  const cardPayments = tickedLines.filter((l) => l.type === "card_payment").length

  return (
    <section aria-labelledby="review-heading" className="grid gap-4 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <h2 id="review-heading" className="text-base font-semibold">
        Review the statement
      </h2>

      <CheckAlert reasons={reasons} confirmed={checkConfirmed} onConfirm={setCheckConfirmed} />
      {initial.balanceWarning && <FormMessage tone="info">{initial.balanceWarning}</FormMessage>}
      <SkippedNotice count={totals.skipped.count} totalMinor={totals.skipped.totalMinor} reasons={totals.skipped.reasons} currency={c} />
      <UnreadableNotice count={initial.unreadableRows} rows={initial.unreadable} />
      {totals.needChoice > 0 && (
        <FormMessage tone="info">
          {totals.needChoice === 1 ? "1 credit needs" : `${totals.needChoice} credits need`} a choice: income, a transfer from your own account, a refund or skip. Nothing is saved
          until you tick it.
        </FormMessage>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <label htmlFor="bulk-category" className="text-sm font-semibold text-ink">
            Category for all ticked expenses
          </label>
          <NativeSelect id="bulk-category" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} className="min-w-56">
            <option value="">Choose a category</option>
            {options.expenseCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button variant="secondary" onClick={applyBulk} disabled={!bulkCategory}>
          Apply to ticked
        </Button>
      </div>

      <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <label key={f.value} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm has-checked:border-ink has-checked:font-semibold">
            <input
              type="radio"
              name="line-filter"
              className="size-4 accent-(--color-ink)"
              checked={filter === f.value}
              onChange={() => {
                setFilter(f.value)
                setPage(0)
              }}
            />
            {f.label}
          </label>
        ))}
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transactions were found in this statement.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lines to show here.</p>
      ) : (
        <ul aria-label="Statement lines" className="grid gap-2">
          {pageLines.map(({ line, index }) => (
            <BankRow
              key={line.key}
              line={line}
              result={results[line.key]}
              options={options}
              context={context}
              onChange={(patch, label) => change(index, patch, label)}
              onType={(type) => setType(index, type)}
            />
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Pages of lines" className="flex flex-wrap items-center gap-3 text-sm">
          <Button variant="secondary" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </Button>
          <span className="tabular-nums">
            Lines {current * PAGE + 1}–{Math.min((current + 1) * PAGE, shown.length)} of {shown.length}
          </span>
          <Button variant="secondary" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next
          </Button>
        </nav>
      )}

      <p className="text-sm font-semibold tabular-nums" aria-live="polite">
        Ticked: {lineText(totals.ticked)} · Money out {money(totals.outMinor, c)} · Money in {money(totals.inMinor, c)}
      </p>

      <div className="grid gap-2">
        {blockers.includes("check_not_confirmed") && <p className="text-xs text-danger">Confirm you have compared the lines with your PDF.</p>}
        {blockers.includes("line_errors") && <p className="text-xs text-danger">Fix the highlighted lines.</p>}
        {blockers.includes("nothing_ticked") && Object.keys(results).length === 0 && <p className="text-xs text-muted-foreground">Tick at least one line.</p>}
        {outcome && outcome.text && <FormMessage tone={outcome.tone}>{outcome.text}</FormMessage>}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={blockers.length > 0 || saving} aria-busy={saving} onClick={() => setConfirming(true)}>
            {saving ? "Saving…" : "Save ticked lines"}
          </Button>
          <span className="text-xs text-muted-foreground">Nothing is saved until you confirm.</span>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent eyebrow={account.name} title="Save these lines?">
          <div className="grid gap-3 text-sm">
            <p className="font-semibold">
              {lineText(tickedLines.length)}: money out {money(totals.outMinor, c)}, money in {money(totals.inMinor, c)}.
            </p>
            {transfers > 0 && <p>Transfers move money between your own accounts: they are neither income nor expenses.</p>}
            {cardPayments > 0 && <p>Card payments are recorded on the card and reduce what it owes; they aren&apos;t expenses.</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
              <Button type="button" onClick={() => void save()}>
                Save {lineText(tickedLines.length)}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function BankRow({
  line,
  result,
  options,
  context,
  onChange,
  onType,
}: {
  line: BankReviewLine
  result: LineSaveResult | undefined
  options: BankImportOptions
  context: Context
  onChange: (patch: Partial<BankReviewLine>, label: boolean) => void
  onType: (type: BankLineType | "") => void
}) {
  const { original } = line
  const description = original.description || "No remarks"
  const name = `${description}, ${fullDate(original.date)}`
  const open = line.status === "new" || line.status === "duplicate"
  const tickable = canTickBank(line)
  const errors = line.ticked ? bankLineErrors(line, options, context) : {}
  const labels = BANK_TYPE_LABELS[original.direction]
  const target =
    line.type === "expense"
      ? { label: "Category", value: line.categoryId, field: "categoryId" as const, items: options.expenseCategories, empty: "Choose a category" }
      : line.type === "income"
        ? { label: "Income source", value: line.categoryId, field: "categoryId" as const, items: options.incomeSources, empty: "Choose an income source" }
        : line.type === "transfer"
          ? { label: original.direction === "debit" ? "To account" : "From account", value: line.otherAccountId, field: "otherAccountId" as const, items: options.accounts, empty: "Choose the account" }
          : line.type === "card_payment"
            ? { label: "Card", value: line.cardId, field: "cardId" as const, items: options.cards, empty: "Choose the card" }
            : null

  return (
    <li className="grid gap-2 rounded-xl border border-line px-3 py-2.5">
      <LineHead
        name={name}
        description={description}
        amountMinor={original.amountMinor}
        direction={original.direction}
        date={original.date}
        currency={context.currency}
        notes={[
          line.status === "skipped" && line.skipReason && SKIP_TEXT[line.skipReason],
          line.transferMatch && "recorded as a transfer",
        ]}
        status={line.status}
        result={result}
        tickable={tickable}
        ticked={line.ticked}
        onTick={(ticked) => onChange({ ticked }, false)}
      />
      {open && (
        <div className="grid gap-2 pl-7 md:grid-cols-[14rem_1fr]">
          <div className="grid gap-1">
            <NativeSelect
              aria-label={`What is ${name}`}
              value={line.type}
              aria-invalid={errors.type ? true : undefined}
              onChange={(e) => onType(e.target.value as BankLineType | "")}
            >
              <option value="">Choose what this is</option>
              {BANK_LINE_TYPES[original.direction].map((t) => (
                <option key={t} value={t}>
                  {labels[t]}
                </option>
              ))}
            </NativeSelect>
            {errors.type && <span className="text-xs text-danger">{errors.type}</span>}
          </div>
          {target && (
            <div className="grid gap-1">
              <NativeSelect
                aria-label={`${target.label} for ${name}`}
                value={target.value}
                aria-invalid={errors.target ? true : undefined}
                onChange={(e) => onChange({ [target.field]: e.target.value }, true)}
              >
                <option value="">{target.empty}</option>
                {target.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </NativeSelect>
              {errors.target && <span className="text-xs text-danger">{errors.target}</span>}
            </div>
          )}
          {line.type === "refund" && <p className="text-xs text-muted-foreground md:col-span-2">{REFUND_NOTE}</p>}
          {line.suggested && !line.ticked && (
            <p className="text-xs text-muted-foreground md:col-span-2">Same as your choice for another {description} line in this file. Tick it to use it.</p>
          )}
        </div>
      )}
      {tickable && line.ticked && (
        <div className="grid gap-2 pl-7 md:grid-cols-[10rem_9rem]">
          <div className="grid gap-1">
            <Input
              type="date"
              aria-label={`Date for ${name}`}
              value={line.date}
              min={context.openingBalanceDate}
              max={context.today}
              aria-invalid={errors.date ? true : undefined}
              onChange={(e) => onChange({ date: e.target.value }, false)}
            />
            {errors.date && <span className="text-xs text-danger">{errors.date}</span>}
          </div>
          <div className="grid gap-1">
            <Input
              inputMode="decimal"
              aria-label={`Amount for ${name}`}
              value={line.amount}
              aria-invalid={errors.amount ? true : undefined}
              onChange={(e) => onChange({ amount: e.target.value }, false)}
            />
            {errors.amount && <span className="text-xs text-danger">{errors.amount}</span>}
          </div>
        </div>
      )}
    </li>
  )
}
