"use client"

import type * as React from "react"
import { useRef, useState } from "react"
import type { ImportCard } from "@fin-creador/api"
import {
  type CardLineSkipReason,
  type CardStatementParse,
  MAX_STATEMENT_PDF_BYTES,
  cardLineDecision,
  parseCardStatement,
  statementNeedsCheck,
} from "@fin-creador/domain"
import { Button } from "@/components/ui/button"
import { FormMessage, TextField } from "@/components/ui/field"
import { fullDate, money } from "@/components/transactions/display"
import { loadPdfjs } from "@/lib/statements/load-pdfjs"
import { PDF_READ_MESSAGES, readStatementPdf } from "@/lib/statements/pdf-reader"

// Statement import, step 9a.3: read a card statement PDF in the browser and show what was read.
// The file and its password never leave the browser; the password is held only while the PDF is
// opened and cleared right after. pdf.js loads on first use. Review and saving come next (9a.4).

const PNB = "Punjab National Bank"

type Phase =
  | { step: "choose"; message?: string }
  | { step: "reading" }
  | { step: "password"; message?: string }
  | { step: "read"; parse: CardStatementParse; asPnb: boolean; pnbOffer: boolean }

const SKIP_TEXT: Record<CardLineSkipReason, string> = {
  payment: "Skipped: payment",
  refund: "Skipped: refund (void the purchase instead)",
  emi: "Skipped: card EMI (paid from the loan)",
  before_card: "Skipped: before you added the card",
  future: "Skipped: future date",
}

export function StatementImport({ card, today }: { card: ImportCard; today: string }) {
  const [phase, setPhase] = useState<Phase>({ step: "choose" })
  const [password, setPassword] = useState("")
  const file = useRef<File | null>(null)
  // The statement's text, for reading it again with the other parser; it never leaves this page.
  const text = useRef<string | null>(null)
  const issuerIsPnb = card.issuer === PNB

  const show = (asPnb: boolean) => {
    if (text.current === null) return
    setPhase({
      step: "read",
      parse: parseCardStatement(text.current, asPnb ? PNB : card.issuer),
      asPnb,
      pnbOffer: !issuerIsPnb && /Punjab National Bank/i.test(text.current),
    })
  }

  const read = async (pdf: File, pass?: string) => {
    setPhase({ step: "reading" })
    try {
      const lib = await loadPdfjs()
      const result = await readStatementPdf(lib, new Uint8Array(await pdf.arrayBuffer()), pass)
      if (result.status === "ok") {
        text.current = result.text
        show(issuerIsPnb)
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
            disabled={phase.step === "reading"}
            className="text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-semibold"
          />
          <p id="statement-pdf-hint" className="text-xs text-muted-foreground">
            Read on this device only: the file and any password are never uploaded or saved. Text PDFs from your bank, up to{" "}
            {MAX_STATEMENT_PDF_BYTES / 1024 / 1024} MB.
          </p>
        </div>
        {phase.step === "choose" && phase.message && <FormMessage tone="error">{phase.message}</FormMessage>}
        {phase.step === "reading" && <FormMessage tone="info">Reading the statement…</FormMessage>}
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

      {phase.step === "read" && (
        <ReadStatement
          card={card}
          today={today}
          parse={phase.parse}
          pnbOffer={phase.pnbOffer}
          asPnb={phase.asPnb}
          onParser={show}
        />
      )}
    </div>
  )
}

function ReadStatement({
  card,
  today,
  parse,
  pnbOffer,
  asPnb,
  onParser,
}: {
  card: ImportCard
  today: string
  parse: CardStatementParse
  pnbOffer: boolean
  asPnb: boolean
  onParser: (asPnb: boolean) => void
}) {
  const { summary, lines, issues } = parse
  const decisions = lines.map((line) => cardLineDecision(line, { cardAddedOn: card.trackingStartedOn, today }))
  const skipped = decisions.filter((d) => !d.importable).length
  const c = card.currency
  const figure = (value: string | null) => value ?? "Not found"

  return (
    <section aria-labelledby="read-heading" className="grid gap-3 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <h2 id="read-heading" className="text-base font-semibold">
        What the statement says
      </h2>
      {pnbOffer && (
        <FormMessage tone="info">
          {asPnb ? "Read as a Punjab National Bank statement." : "This looks like a Punjab National Bank statement."}{" "}
          <button type="button" className="font-semibold underline underline-offset-4" onClick={() => onParser(!asPnb)}>
            {asPnb ? "Use the general reader" : "Read it as a PNB statement"}
          </button>
        </FormMessage>
      )}
      {statementNeedsCheck(parse) && (
        <FormMessage tone="error">
          Check this statement: its totals don&apos;t match the lines read. Compare them with your PDF before saving anything.
        </FormMessage>
      )}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Statement date", figure(summary.statementDate && fullDate(summary.statementDate))],
          ["Bill total", figure(summary.totalMinor === null ? null : money(summary.totalMinor, c))],
          ["Minimum due", figure(summary.minimumMinor === null ? null : money(summary.minimumMinor, c))],
          ["Due date", figure(summary.dueDate && fullDate(summary.dueDate))],
        ].map(([term, value]) => (
          <div key={term} className="grid gap-0.5">
            <dt className="text-xs text-muted-foreground">{term}</dt>
            <dd className="text-sm font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {skipped > 0 && (
        <FormMessage tone="info">
          {skipped === 1 ? "1 line is skipped" : `${skipped} lines are skipped`} (payments, refunds, card EMIs or dates outside the card&apos;s
          time with you); each is marked below.
        </FormMessage>
      )}
      {issues.length > 0 && (
        <FormMessage tone="error">
          {issues.length === 1 ? "1 line couldn't be read" : `${issues.length} lines couldn't be read`}. Compare the list with your PDF.
        </FormMessage>
      )}
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transactions were found in this statement.</p>
      ) : (
        <ul aria-label="Statement lines" className="grid gap-1.5">
          {lines.map((line, i) => {
            const decision = decisions[i]!
            return (
              <li key={i} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded-xl border border-line px-3 py-2 md:grid-cols-[7rem_1fr_auto_14rem]">
                <span className="text-xs text-muted-foreground md:text-sm md:text-ink">{fullDate(line.date)}</span>
                <span className="col-span-2 row-start-2 min-w-0 truncate text-sm font-semibold md:col-span-1 md:row-start-auto">{line.description}</span>
                <span className="row-start-1 text-right text-sm font-semibold tabular-nums md:row-start-auto">
                  {money(line.amountMinor, c)} {line.direction === "credit" ? "Cr" : "Dr"}
                </span>
                <span className="col-span-2 text-xs text-muted-foreground md:col-span-1 md:text-right">
                  {decision.importable ? "To import" : SKIP_TEXT[decision.reason]}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Nothing is saved yet: choosing which lines to save comes next.</p>
    </section>
  )
}
