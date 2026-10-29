"use client"

import type * as React from "react"
import { useRef, useState } from "react"
import {
  type ImportCard,
  type Review,
  type ReviewCategory,
  type ReviewLine,
  buildReview,
  canTick,
  checkReasons,
  lineErrors,
  reviewKeys,
  reviewTotals,
  saveBlockers,
} from "@fin-creador/api"
import {
  type CardLineSkipReason,
  type CardStatementParse,
  MAX_STATEMENT_PDF_BYTES,
  minorToGroupedInputString,
  parseCardStatement,
} from "@fin-creador/domain"
import { importMatchesAction } from "@/app/(app)/loans-liabilities/import/actions"
import { fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FormMessage, TextField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { loadPdfjs } from "@/lib/statements/load-pdfjs"
import { PDF_READ_MESSAGES, readStatementPdf } from "@/lib/statements/pdf-reader"

// Card statement import (Sprint 9a.3 and 9a.4): read the PDF in the browser, then review it: a
// tick and an editable date, amount and category per line. The file and its password never
// leave the browser (the password is cleared after each attempt); only request keys and a date
// range go to the server, to find lines already imported and possible duplicates. Saving is 9a.5.

const PNB = "Punjab National Bank"

type Phase =
  | { step: "choose"; message?: string }
  | { step: "reading" }
  | { step: "password"; message?: string }
  | { step: "matching" }
  | { step: "match_failed" }
  | { step: "review"; review: Review; asPnb: boolean; pnbOffer: boolean }

type Context = { cardId: string; cardAddedOn: string; today: string; currency: string }

const SKIP_TEXT: Record<CardLineSkipReason, string> = {
  payment: "Skipped: payment",
  refund: "Skipped: refund (void the purchase instead)",
  emi: "Skipped: card EMI (paid from the loan)",
  before_card: "Skipped: before you added the card",
  future: "Skipped: future date",
}

function dateRange(parse: CardStatementParse, fallback: string): { from: string; to: string } {
  const dates = parse.lines.map((l) => l.date).sort()
  return { from: dates[0] ?? fallback, to: dates.at(-1) ?? fallback }
}

export function StatementImport({ card, today, categories }: { card: ImportCard; today: string; categories: ReviewCategory[] }) {
  const [phase, setPhase] = useState<Phase>({ step: "choose" })
  const [password, setPassword] = useState("")
  const file = useRef<File | null>(null)
  // The statement's text, for reading it again with the other parser; it never leaves this page.
  const text = useRef<string | null>(null)
  const issuerIsPnb = card.issuer === PNB
  const context: Context = { cardId: card.id, cardAddedOn: card.trackingStartedOn, today, currency: card.currency }

  const review = async (asPnb: boolean) => {
    if (text.current === null) return
    const parse = parseCardStatement(text.current, asPnb ? PNB : card.issuer)
    const pnbOffer = !issuerIsPnb && /Punjab National Bank/i.test(text.current)
    setPhase({ step: "matching" })
    const result = await importMatchesAction({
      cardId: card.id,
      keys: reviewKeys(card.id, parse),
      ...dateRange(parse, today),
      statementDate: parse.summary.statementDate,
    }).catch(() => null)
    if (!result?.ok) return setPhase({ step: "match_failed" })
    setPhase({ step: "review", review: buildReview(parse, result.matches, categories, context), asPnb, pnbOffer })
  }

  const read = async (pdf: File, pass?: string) => {
    setPhase({ step: "reading" })
    try {
      const lib = await loadPdfjs()
      const result = await readStatementPdf(lib, new Uint8Array(await pdf.arrayBuffer()), pass)
      if (result.status === "ok") {
        text.current = result.text
        await review(issuerIsPnb)
      } else if (result.status === "needs_password") setPhase({ step: "password" })
      else if (result.status === "wrong_password") setPhase({ step: "password", message: PDF_READ_MESSAGES.wrong_password })
      else setPhase({ step: "choose", message: PDF_READ_MESSAGES[result.status] })
    } catch {
      setPhase({ step: "choose", message: PDF_READ_MESSAGES.unreadable })
    } finally {
      setPassword("")
    }
  }

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null
    e.target.value = ""
    text.current = null
    file.current = null
    if (!picked) return
    if (!/\.pdf$/i.test(picked.name) && picked.type !== "application/pdf") return setPhase({ step: "choose", message: "Choose a PDF file." })
    if (picked.size > MAX_STATEMENT_PDF_BYTES) return setPhase({ step: "choose", message: PDF_READ_MESSAGES.too_large })
    file.current = picked
    void read(picked)
  }

  const openWithPassword = (e: React.FormEvent) => {
    e.preventDefault()
    if (file.current && password !== "") void read(file.current, password)
  }

  const busy = phase.step === "reading" || phase.step === "matching"

  return (
    <div className="grid gap-4">
      <section aria-labelledby="pdf-heading" className="grid gap-3 rounded-2xl border border-line bg-surface p-4 md:p-5">
        <h2 id="pdf-heading" className="text-base font-semibold">
          Statement PDF
        </h2>
        <div className="grid gap-1.5">
          <label htmlFor="statement-pdf" className="text-sm font-semibold text-ink">
            Choose your {card.name} statement (PDF)
          </label>
          <input
            id="statement-pdf"
            type="file"
            accept="application/pdf,.pdf"
            aria-describedby="statement-pdf-hint"
            onChange={choose}
            disabled={busy}
            className="text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-semibold"
          />
          <p id="statement-pdf-hint" className="text-xs text-muted-foreground">
            Read on this device only: the file and any password are never uploaded or saved. Text PDFs from your bank, up to{" "}
            {MAX_STATEMENT_PDF_BYTES / 1024 / 1024} MB.
          </p>
        </div>
        {phase.step === "choose" && phase.message && <FormMessage tone="error">{phase.message}</FormMessage>}
        {phase.step === "reading" && <FormMessage tone="info">Reading the statement…</FormMessage>}
        {phase.step === "matching" && <FormMessage tone="info">Checking it against your entries…</FormMessage>}
        {phase.step === "match_failed" && (
          <FormMessage tone="error">
            We couldn&apos;t check this statement against your entries. Check your connection.{" "}
            <button type="button" className="font-semibold underline underline-offset-4" onClick={() => void review(issuerIsPnb)}>
              Try again
            </button>
          </FormMessage>
        )}
        {phase.step === "password" && (
          <form onSubmit={openWithPassword} className="grid gap-3 md:max-w-sm" autoComplete="off">
            {phase.message ? (
              <FormMessage tone="error">{phase.message}</FormMessage>
            ) : (
              <FormMessage tone="info">This PDF is protected. Enter the password your bank gave for it.</FormMessage>
            )}
            <TextField
              name="pdf-password"
              type="password"
              label="PDF password"
              hint="Used once to open the file, then cleared. Never saved or sent."
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div>
              <Button type="submit" disabled={password === ""}>
                Open PDF
              </Button>
            </div>
          </form>
        )}
      </section>

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
          onParser={(asPnb) => void review(asPnb)}
        />
      )}
    </div>
  )
}

const STATUS_BADGE: Partial<Record<ReviewLine["status"], { text: string; tone: "info" | "neutral" }>> = {
  duplicate: { text: "Possible duplicate", tone: "info" },
  imported: { text: "Already imported", tone: "neutral" },
}

function StatementReview({
  card,
  categories,
  context,
  initial,
  pnbOffer,
  asPnb,
  onParser,
}: {
  card: ImportCard
  categories: ReviewCategory[]
  context: Context
  initial: Review
  pnbOffer: boolean
  asPnb: boolean
  onParser: (asPnb: boolean) => void
}) {
  const [lines, setLines] = useState(initial.lines)
  const [checkConfirmed, setCheckConfirmed] = useState(false)
  const [bulkCategory, setBulkCategory] = useState("")
  const s = initial.statement
  const c = card.currency
  const symbol = c === "INR" ? "₹" : c
  const [statement, setStatement] = useState({
    enter: !s.exists && s.statementDate !== null && s.totalMinor !== null,
    statementDate: s.statementDate ?? "",
    total: s.totalMinor === null ? "" : minorToGroupedInputString(s.totalMinor, c),
    minimum: s.minimumMinor === null ? "" : minorToGroupedInputString(s.minimumMinor, c),
    dueDate: s.dueDate ?? "",
  })
  const review: Review = { ...initial, lines }
  const totals = reviewTotals(review, c)
  const reasons = checkReasons(initial.checks, c)
  const blockers = saveBlockers(review, categories, context, checkConfirmed)

  const update = (i: number, patch: Partial<ReviewLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const applyBulk = () => {
    if (bulkCategory) setLines((ls) => ls.map((l) => (l.ticked ? { ...l, categoryId: bulkCategory } : l)))
  }
  const setField = (name: Exclude<keyof typeof statement, "enter">) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setStatement((v) => ({ ...v, [name]: e.target.value }))

  return (
    <section aria-labelledby="review-heading" className="grid gap-4 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <h2 id="review-heading" className="text-base font-semibold">
        Review the statement
      </h2>

      {pnbOffer && (
        <FormMessage tone="info">
          {asPnb ? "Read as a Punjab National Bank statement." : "This looks like a Punjab National Bank statement."}{" "}
          <button type="button" className="font-semibold underline underline-offset-4" onClick={() => onParser(!asPnb)}>
            {asPnb ? "Use the general reader" : "Read it as a PNB statement"}
          </button>
        </FormMessage>
      )}

      {reasons.length > 0 && (
        <div role="alert" className="grid gap-2 rounded-xl bg-chip-peach px-3 py-2.5 text-sm text-danger">
          <p className="font-semibold">Check this statement</p>
          <ul className="grid list-disc gap-1 pl-5">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <label className="flex items-start gap-2 font-semibold text-ink">
            <input type="checkbox" className="mt-0.5 size-4 accent-(--color-ink)" checked={checkConfirmed} onChange={(e) => setCheckConfirmed(e.target.checked)} />
            I have compared these lines with my PDF
          </label>
        </div>
      )}

      {totals.skipped.count > 0 && (
        <FormMessage tone="info">
          {totals.skipped.count === 1 ? "1 line is skipped" : `${totals.skipped.count} lines are skipped`} ({money(totals.skipped.totalMinor, c)}):{" "}
          {totals.skipped.reasons.join(", ")}. Each is marked below.
        </FormMessage>
      )}
      {initial.unreadableRows > 0 && (
        <FormMessage tone="error">
          {initial.unreadableRows === 1 ? "1 row could not be read" : `${initial.unreadableRows} rows could not be read`}. Compare the lines with your PDF.
        </FormMessage>
      )}

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
        <p className="text-sm text-muted-foreground">No transactions were found in this statement.</p>
      ) : (
        <ul aria-label="Statement lines" className="grid gap-2">
          {lines.map((line, i) => (
            <ReviewRow key={line.key} line={line} categories={categories} context={context} onChange={(patch) => update(i, patch)} />
          ))}
        </ul>
      )}

      <p className="text-sm font-semibold tabular-nums" aria-live="polite">
        Ticked: {money(totals.tickedMinor, c)} ({totals.ticked === 1 ? "1 line" : `${totals.ticked} lines`}) · Bill total:{" "}
        {s.totalMinor === null ? "not found" : money(s.totalMinor, c)}
      </p>

      <fieldset className="grid gap-3 rounded-xl border border-line p-3">
        <legend className="px-1 text-sm font-semibold">Enter statement</legend>
        {s.exists ? (
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
                <TextField name="statementDate" type="date" label="Statement date" value={statement.statementDate} max={context.today} onChange={setField("statementDate")} />
                <TextField name="total" label={`Bill total (${symbol})`} inputMode="decimal" value={statement.total} onChange={setField("total")} />
                <TextField name="minimum" label={`Minimum due (${symbol})`} inputMode="decimal" value={statement.minimum} onChange={setField("minimum")} />
                <TextField name="dueDate" type="date" label="Due date" value={statement.dueDate} onChange={setField("dueDate")} />
              </div>
            )}
          </>
        )}
      </fieldset>

      <div className="grid gap-2">
        {blockers.includes("check_not_confirmed") && <p className="text-xs text-danger">Confirm you have compared the lines with your PDF.</p>}
        {blockers.includes("line_errors") && <p className="text-xs text-danger">Fix the highlighted lines.</p>}
        {blockers.includes("nothing_ticked") && <p className="text-xs text-muted-foreground">Tick at least one line.</p>}
        <div className="flex flex-wrap items-center gap-3">
          {/* Saving is the next step (9a.5); until then the button stays off. */}
          <Button disabled aria-describedby="save-note">
            Save ticked lines
          </Button>
          <span id="save-note" className="text-xs text-muted-foreground">
            {blockers.length === 0 ? "Ready. Saving comes in the next update; nothing is saved yet." : "Nothing is saved yet."}
          </span>
        </div>
      </div>
    </section>
  )
}

function ReviewRow({
  line,
  categories,
  context,
  onChange,
}: {
  line: ReviewLine
  categories: ReviewCategory[]
  context: Context
  onChange: (patch: Partial<ReviewLine>) => void
}) {
  const { original } = line
  const tickable = canTick(line)
  const errors = line.ticked ? lineErrors(line, categories, context) : {}
  const name = `${original.description}, ${fullDate(original.date)}`
  const badge = STATUS_BADGE[line.status]

  return (
    <li className="grid gap-2 rounded-xl border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        {tickable ? (
          <input
            type="checkbox"
            aria-label={`Import ${name}`}
            className="mt-0.5 size-4 accent-(--color-ink)"
            checked={line.ticked}
            onChange={(e) => onChange({ ticked: e.target.checked })}
          />
        ) : (
          <span aria-hidden="true" className="mt-0.5 size-4" />
        )}
        <span className="min-w-0 flex-1 text-sm font-semibold break-words">{original.description}</span>
        <span className="text-sm font-semibold tabular-nums">
          {money(original.amountMinor, context.currency)} {original.direction === "credit" ? "Cr" : "Dr"}
        </span>
        <span className="basis-full pl-7 text-xs text-muted-foreground">
          {fullDate(original.date)}
          {line.status === "skipped" && line.skipReason && ` · ${SKIP_TEXT[line.skipReason]}`}
          {original.foreignCurrency && ` · paid in ${original.foreignCurrency}`}
        </span>
        {badge && (
          <span className="pl-7">
            <Badge tone={badge.tone}>{badge.text}</Badge>
          </span>
        )}
      </div>
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
        </div>
      )}
    </li>
  )
}
