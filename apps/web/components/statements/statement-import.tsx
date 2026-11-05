"use client"

import type * as React from "react"
import { useState } from "react"
import {
  type ImportCard,
  type LineSaveResult,
  type Review,
  type ReviewCategory,
  type RefundCandidate,
  type ReviewLine,
  GENERAL_READER_NOTE,
  UNREADABLE_FILE,
  buildReview,
  canTick,
  checkReasons,
  importOutcome,
  isRefundLine,
  lineErrors,
  refundCandidateLabel,
  refundOptions,
  reviewKeys,
  reviewTotals,
  saveBlockers,
  STATEMENT_DATE_MISSING,
  statementDatesWarning,
  unsupportedIssuerMessage,
} from "@fin-creador/api"
import { type CardLineSkipReason, type CardStatementParse, minorToGroupedInputString, parseAmount, parseCardStatement } from "@fin-creador/domain"
import { IMPORT_SAVE_CHUNK } from "@fin-creador/schemas"
import { importMatchesAction, importStatementAction, saveImportLinesAction } from "@/app/(app)/loans-liabilities/import/actions"
import { fullDate, money } from "@/components/transactions/display"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { FormMessage, TextField } from "@/components/ui/field"
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
  saveInChunks,
  savedOutcome,
  useStatementReader,
} from "./statement-shared"

// Card statement import (Sprint 9a.3 and 9a.4): read the PDF in the browser, then review it: a
// tick and an editable date, amount and category per line. The file and its password never
// leave the browser (the password is cleared after each attempt); only request keys and a date
// range go to the server, to find lines already imported and possible duplicates. Save (9a.5)
// sends the ticked lines in chunks, each line saved on its own, then enters the statement; a
// cut-off import is finished by saving again (the same key is never posted twice).

const PNB = "Punjab National Bank"

type CardReviewPhase = { review: Review; asPnb: boolean; pnbOffer: boolean; general: boolean }

type Context = { cardId: string; cardAddedOn: string; today: string; currency: string }

const SKIP_TEXT: Record<CardLineSkipReason, string> = {
  payment: "Skipped: payment",
  emi: "Skipped: card EMI (paid from the loan)",
  before_card: "Skipped: before you added the card",
  future: "Skipped: future date",
}

function dateRange(parse: CardStatementParse, fallback: string): { from: string; to: string } {
  const dates = parse.lines.map((l) => l.date).sort()
  return { from: dates[0] ?? fallback, to: dates.at(-1) ?? fallback }
}

export function StatementImport({ card, today, categories }: { card: ImportCard; today: string; categories: ReviewCategory[] }) {
  const issuerIsPnb = card.issuer === PNB
  const context: Context = { cardId: card.id, cardAddedOn: card.trackingStartedOn, today, currency: card.currency }

  /** A file this card's reader can't use: the PNB message, or that the issuer isn't supported yet. */
  const cannotRead = (pnbOffer = false) => ({ step: "message" as const, text: issuerIsPnb ? UNREADABLE_FILE : unsupportedIssuerMessage(card.issuer), pnbOffer })

  const reader: ReturnType<typeof useStatementReader<CardReviewPhase>> = useStatementReader<CardReviewPhase>({
    onText: (): Promise<void> => review(issuerIsPnb),
    cannotRead: () => cannotRead(),
    wrongPassword: issuerIsPnb ? UNREADABLE_FILE : PDF_READ_MESSAGES.wrong_password,
  })
  const { phase, setPhase, attemptRef } = reader

  async function review(asPnb: boolean): Promise<void> {
    const read = reader.readRef.current
    if (read === null) return
    const id = ++attemptRef.current
    const parse = parseCardStatement(read.text, asPnb ? PNB : card.issuer)
    const pnbOffer = !issuerIsPnb && /Punjab National Bank/i.test(read.text)
    const outcome = importOutcome(parse, asPnb)
    if (outcome === "unreadable") return void setPhase({ step: "message", text: UNREADABLE_FILE, pnbOffer: false })
    if (outcome === "unsupported") return void setPhase(cannotRead(pnbOffer))
    setPhase({ step: "matching" })
    const result = await importMatchesAction({
      cardId: card.id,
      keys: reviewKeys(card.id, parse),
      ...dateRange(parse, today),
      statementDate: parse.summary.statementDate,
    }).catch(() => null)
    if (id !== attemptRef.current) return
    if (!result?.ok) return void setPhase({ step: "match_failed" })
    setPhase({
      step: "review",
      review: buildReview(parse, result.matches, categories, context, read.pageRowCounts, read.rowLayouts),
      asPnb,
      pnbOffer,
      general: outcome === "general",
    })
  }

  return (
    <div className="grid gap-4">
      <StatementFileSection
        label={`Choose your ${card.issuer} statement (PDF)`}
        reader={reader}
        onRetry={() => void review(issuerIsPnb)}
        messageExtra={
          <>
            {" "}
            This looks like a Punjab National Bank statement.{" "}
            <button type="button" className="font-semibold underline underline-offset-4" onClick={() => void review(true)}>
              Read it as a PNB statement
            </button>
          </>
        }
      />

      {phase.step === "review" && (
        <StatementReview
          // A new statement (or the other parser) starts a fresh review.
          key={`${phase.asPnb}-${phase.review.lines.map((l) => l.key).join()}`}
          card={card}
          categories={categories}
          context={context}
          initial={phase.review}
          pnbOffer={phase.pnbOffer}
          asPnb={phase.asPnb}
          general={phase.general}
          onParser={(asPnb) => void review(asPnb)}
        />
      )}
    </div>
  )
}

function StatementReview({
  card,
  categories,
  context,
  initial,
  pnbOffer,
  asPnb,
  general,
  onParser,
}: {
  card: ImportCard
  categories: ReviewCategory[]
  context: Context
  initial: Review
  pnbOffer: boolean
  asPnb: boolean
  general: boolean
  onParser: (asPnb: boolean) => void
}) {
  const [lines, setLines] = useState(initial.lines)
  const [checkConfirmed, setCheckConfirmed] = useState(false)
  const [bulkCategory, setBulkCategory] = useState("")
  const s = initial.statement
  const c = card.currency
  const symbol = c === "INR" ? "₹" : c
  const [statement, setStatement] = useState({
    enter: !s.exists && s.totalMinor !== null,
    statementDate: s.statementDate ?? "",
    total: s.totalMinor === null ? "" : minorToGroupedInputString(s.totalMinor, c),
    minimum: s.minimumMinor === null ? "" : minorToGroupedInputString(s.minimumMinor, c),
    dueDate: s.dueDate ?? "",
  })
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<Record<string, LineSaveResult>>({})
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null)
  const [statementDone, setStatementDone] = useState(s.exists)
  const review: Review = { ...initial, lines }
  const totals = reviewTotals(review, c)
  const reasons = checkReasons(initial.checks, c)
  const statementOnly = statement.enter && !statementDone && !s.exists
  const blockers = saveBlockers(review, categories, context, checkConfirmed, { enters: statementOnly, date: statement.statementDate })
  const datesWarning = statementOnly ? statementDatesWarning(statement.statementDate, statement.dueDate) : null

  const update = (i: number, patch: Partial<ReviewLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const applyBulk = () => {
    if (bulkCategory) setLines((ls) => ls.map((l) => (l.ticked ? { ...l, categoryId: bulkCategory } : l)))
  }

  const save = async () => {
    setConfirming(false)
    setSaving(true)
    setOutcome(null)
    const ticked = lines.filter((l) => l.ticked)
    const { done, stopped } = await saveInChunks(
      ticked,
      IMPORT_SAVE_CHUNK,
      (chunk) =>
        saveImportLinesAction({
          cardId: card.id,
          statementDate: s.statementDate ?? "",
          lines: chunk.map((l) => ({ original: l.original, date: l.date, amount: l.amount, categoryId: l.categoryId, refundOfId: l.refundOfId })),
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
      },
    )
    const first = savedOutcome(ticked.length, done, stopped)
    if (first.tone === "error") {
      setOutcome(first)
    } else {
      let text = first.text
      let tone: SaveOutcome["tone"] = "success"
      if (statement.enter && !statementDone) {
        const st = await importStatementAction({
          cardId: card.id,
          statementDate: statement.statementDate,
          total: statement.total,
          minimum: statement.minimum,
          dueDate: statement.dueDate,
        }).catch(() => null)
        if (st && st.status !== "error") setStatementDone(true)
        if (!st || st.status === "error") tone = "error"
        text = `${text} ${st?.message ?? "The statement wasn't entered: check your connection and try again."}`.trim()
      } else if (s.exists) text += " The statement for this date was already entered."
      setOutcome({ tone, text })
    }
    setSaving(false)
  }

  const tickedLines = lines.filter((l) => l.ticked)
  const setField = (name: Exclude<keyof typeof statement, "enter">) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setStatement((v) => ({ ...v, [name]: e.target.value }))

  return (
    <section aria-labelledby="review-heading" className="grid gap-4 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <h2 id="review-heading" className="text-base font-semibold">
        Review the statement
      </h2>

      {general && <FormMessage tone="info">{GENERAL_READER_NOTE}</FormMessage>}
      {pnbOffer && (
        <FormMessage tone="info">
          {asPnb ? "Read as a Punjab National Bank statement." : "This looks like a Punjab National Bank statement."}{" "}
          <button type="button" className="font-semibold underline underline-offset-4" onClick={() => onParser(!asPnb)}>
            {asPnb ? "Use the general reader" : "Read it as a PNB statement"}
          </button>
        </FormMessage>
      )}

      <CheckAlert reasons={reasons} confirmed={checkConfirmed} onConfirm={setCheckConfirmed} />
      <SkippedNotice count={totals.skipped.count} totalMinor={totals.skipped.totalMinor} reasons={totals.skipped.reasons} currency={c} />
      <UnreadableNotice count={initial.unreadableRows} rows={initial.unreadable} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <label htmlFor="bulk-category" className="text-sm font-semibold text-ink">
            Category for all ticked lines
          </label>
          <NativeSelect id="bulk-category" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} className="min-w-56">
            <option value="">Choose a category</option>
            {categories.map((cat) => (
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

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing was found in this statement.</p>
      ) : (
        <ul aria-label="Statement lines" className="grid gap-2">
          {lines.map((line, i) => (
            <ReviewRow
              key={line.key}
              line={line}
              result={results[line.key]}
              categories={categories}
              candidates={initial.refundCandidates}
              context={context}
              onChange={(patch) => update(i, patch)}
            />
          ))}
        </ul>
      )}

      <p className="text-sm font-semibold tabular-nums" aria-live="polite">
        Ticked: {money(totals.tickedMinor, c)} ({totals.ticked === 1 ? "1 line" : `${totals.ticked} lines`}
        {totals.tickedRefunds > 0 && `, refunds taken off`}) · Bill total:{" "}
        {s.totalMinor === null ? "not found" : money(s.totalMinor, c)}
      </p>

      <fieldset className="grid gap-3 rounded-xl border border-line p-3">
        <legend className="px-1 text-sm font-semibold">Enter statement</legend>
        {statementDone && !s.exists ? (
          <FormMessage tone="success">The statement is entered.</FormMessage>
        ) : s.exists ? (
          <FormMessage tone="info">
            A statement of {s.statementDate ? fullDate(s.statementDate) : "this date"} is already entered for this card. Only the lines will be saved.
          </FormMessage>
        ) : (
          <>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-(--color-ink)"
                checked={statement.enter}
                onChange={(e) => setStatement((v) => ({ ...v, enter: e.target.checked }))}
              />
              <span>
                <span className="font-semibold">Also enter this statement</span>
                <span className="block text-xs text-muted-foreground">From the statement: change anything that was read wrongly.</span>
              </span>
            </label>
            {statement.enter && (
              <div className="grid gap-3 md:grid-cols-4">
                <TextField
                  name="statementDate"
                  type="date"
                  label="Statement date"
                  value={statement.statementDate}
                  max={context.today}
                  error={statement.statementDate === "" ? STATEMENT_DATE_MISSING : undefined}
                  onChange={setField("statementDate")}
                />
                <TextField name="total" label={`Bill total (${symbol})`} inputMode="decimal" value={statement.total} onChange={setField("total")} />
                <TextField name="minimum" label={`Minimum due (${symbol})`} inputMode="decimal" value={statement.minimum} onChange={setField("minimum")} />
                <TextField name="dueDate" type="date" label="Due date" value={statement.dueDate} onChange={setField("dueDate")} />
              </div>
            )}
            {datesWarning && <FormMessage tone="error">{datesWarning}</FormMessage>}
          </>
        )}
      </fieldset>

      <div className="grid gap-2">
        {blockers.includes("check_not_confirmed") && <p className="text-xs text-danger">Confirm you have compared the lines with your PDF.</p>}
        {blockers.includes("line_errors") && <p className="text-xs text-danger">Fix the highlighted lines.</p>}
        {blockers.includes("statement_date_missing") && <p className="text-xs text-danger">Enter the statement date.</p>}
        {blockers.includes("nothing_ticked") && Object.keys(results).length === 0 && <p className="text-xs text-muted-foreground">Tick at least one line.</p>}
        {outcome && <FormMessage tone={outcome.tone}>{outcome.text}</FormMessage>}
        {statement.enter && !statementDone && tickedLines.length === 0 && Object.keys(results).length > 0 && !saving && (
          <div>
            <Button variant="secondary" disabled={blockers.includes("statement_date_missing")} onClick={() => void save()}>
              Enter the statement
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={blockers.length > 0 || saving} aria-busy={saving} onClick={() => setConfirming(true)}>
            {saving ? "Saving…" : tickedLines.length === 0 && statementOnly ? "Save statement only" : "Save ticked lines"}
          </Button>
          <span className="text-xs text-muted-foreground">Nothing is saved until you confirm.</span>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          eyebrow={card.name}
          title={tickedLines.length === 0 ? "Enter this statement?" : totals.tickedRefunds > 0 ? "Save these lines?" : "Save these purchases?"}
        >
          {tickedLines.length === 0 ? (
            <div className="grid gap-3 text-sm">
              <p className="font-semibold">No lines are saved: only the statement is entered.</p>
              <p>
                The statement of {statement.statementDate ? fullDate(statement.statementDate) : "this date"} is entered (bill {symbol}
                {statement.total}). If the bill is more than the card owes, the difference is added in Bank charges &amp; interest.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
                <Button type="button" onClick={() => void save()}>
                  Enter statement
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 text-sm">
              <p className="font-semibold">
                {[tickedLines.length > totals.tickedRefunds && countText(tickedLines.length - totals.tickedRefunds, "purchase"), totals.tickedRefunds > 0 && countText(totals.tickedRefunds, "refund")]
                  .filter(Boolean)
                  .join(" and ")}
                , {money(totals.tickedMinor, c)} in all.
              </p>
              <p>
                {tickedLines.length > totals.tickedRefunds &&
                  "These are purchases already made on the card. No money moves from any bank account: they are added to what the card owes. "}
                {totals.tickedRefunds > 0 && "Refunds come off what the card owes and lower their category's spending."}
              </p>
              {s.exists ? (
                <p>A statement for this date is already entered: only the lines are saved.</p>
              ) : statement.enter && !statementDone ? (
                <p>
                  Then the statement of {statement.statementDate ? fullDate(statement.statementDate) : "this date"} is entered (bill {symbol}
                  {statement.total}). If the bill is more than the card owes, the difference is added in Bank charges &amp; interest.
                </p>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
                <Button type="button" onClick={() => void save()}>
                  Save {tickedLines.length === 1 ? "1 line" : `${tickedLines.length} lines`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

const countText = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

function ReviewRow({
  line,
  result,
  categories,
  candidates,
  context,
  onChange,
}: {
  line: ReviewLine
  result: LineSaveResult | undefined
  categories: ReviewCategory[]
  candidates: RefundCandidate[]
  context: Context
  onChange: (patch: Partial<ReviewLine>) => void
}) {
  const { original } = line
  const tickable = canTick(line)
  const errors = line.ticked ? lineErrors(line, categories, context) : {}
  const name = `${original.description}, ${fullDate(original.date)}`
  const refund = isRefundLine(line)

  return (
    <li className="grid gap-2 rounded-xl border border-line px-3 py-2.5">
      <LineHead
        name={name}
        description={original.description}
        amountMinor={original.amountMinor}
        direction={original.direction}
        date={original.date}
        currency={context.currency}
        notes={[
          refund && "Refund",
          line.status === "skipped" && line.skipReason && SKIP_TEXT[line.skipReason],
          original.foreignCurrency && `paid in ${original.foreignCurrency}`,
        ]}
        status={line.status}
        result={result}
        tickable={tickable}
        ticked={line.ticked}
        onTick={(ticked) => onChange({ ticked })}
      />
      {tickable && line.ticked && (
        <div className="grid gap-2 pl-7 md:grid-cols-[10rem_9rem_1fr]">
          <div className="grid gap-1">
            <Input
              type="date"
              aria-label={`Date for ${name}`}
              value={line.date}
              min={context.cardAddedOn}
              max={context.today}
              aria-invalid={errors.date ? true : undefined}
              onChange={(e) => onChange({ date: e.target.value })}
            />
            {errors.date && <span className="text-xs text-danger">{errors.date}</span>}
          </div>
          <div className="grid gap-1">
            <Input
              inputMode="decimal"
              aria-label={`Amount for ${name}`}
              value={line.amount}
              aria-invalid={errors.amount ? true : undefined}
              onChange={(e) => onChange({ amount: e.target.value })}
            />
            {errors.amount && <span className="text-xs text-danger">{errors.amount}</span>}
          </div>
          <div className="grid gap-1">
            <NativeSelect
              aria-label={`Category for ${name}`}
              value={line.categoryId}
              aria-invalid={errors.categoryId ? true : undefined}
              onChange={(e) => onChange({ categoryId: e.target.value })}
            >
              <option value="">Choose a category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </NativeSelect>
            {errors.categoryId && <span className="text-xs text-danger">{errors.categoryId}</span>}
          </div>
          {refund && (
            <RefundOfSelect
              name={name}
              line={line}
              candidates={candidates}
              categories={categories}
              currency={context.currency}
              onChange={(refundOfId) => {
                // Linking takes the purchase's category when none is chosen yet.
                const category = candidates.find((c) => c.id === refundOfId)?.categoryId
                onChange({ refundOfId, ...(line.categoryId === "" && category && categories.some((cat) => cat.id === category) ? { categoryId: category } : {}) })
              }}
            />
          )}
        </div>
      )}
      {tickable && !line.ticked && refund && line.categoryId === "" && (
        <p className="pl-7 text-xs text-muted-foreground">Tick it, then choose the category it refunds.</p>
      )}
    </li>
  )
}

/** "Refund of": the card purchase this refund reverses, or none (it still counts). */
function RefundOfSelect({
  name,
  line,
  candidates,
  categories,
  currency,
  onChange,
}: {
  name: string
  line: ReviewLine
  candidates: RefundCandidate[]
  categories: ReviewCategory[]
  currency: string
  onChange: (refundOfId: string) => void
}) {
  const amount = parseAmount(line.amount, currency)
  const options = refundOptions({ date: line.date, amountMinor: amount.ok ? amount.minor : null }, candidates, line.refundOfId)
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null
  return (
    <div className="grid gap-1 md:col-span-3">
      <NativeSelect aria-label={`Refund of, for ${name}`} value={line.refundOfId} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not linked to a purchase</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            Refund of {refundCandidateLabel(c, categoryName, currency)}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}
