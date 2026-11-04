"use client"

import type * as React from "react"
import { useRef, useState } from "react"
import { type LineSaveResult, type UnreadableRow, unreadableLayoutText } from "@fin-creador/api"
import { type BankTableRow, MAX_STATEMENT_PDF_BYTES } from "@fin-creador/domain"
import { fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FormMessage, TextField } from "@/components/ui/field"
import { loadPdfjs } from "@/lib/statements/load-pdfjs"
import { PDF_READ_MESSAGES, readStatementPdf } from "@/lib/statements/pdf-reader"

// The parts of a statement import shared by card statements (9a) and bank statements (9b): the
// file picker with its reading and password steps, the "Check this statement" alert, the skipped
// and unreadable notices (with Copy layout), the head of a review line, and saving ticked lines in
// chunks. The file and its password never leave the browser (the password is cleared after each
// attempt); a new pick drops everything from the previous file at once.

export type FilePhase<R> =
  | { step: "choose"; message?: string }
  | { step: "reading" }
  | { step: "password"; message?: string }
  | { step: "matching" }
  | { step: "match_failed" }
  /** No review and no Save: the file can't be read, or its issuer isn't supported yet. */
  | { step: "message"; text: string; pnbOffer: boolean }
  | ({ step: "review" } & R)

/** What a successful read gives the import: the statement's text, its format, and (PDF) where its rows are. */
export type StatementText = { text: string; format: "pdf" | "csv"; pageRowCounts?: number[]; rowLayouts?: string[]; rows?: BankTableRow[] }

const isCsv = (file: File) => /\.csv$/i.test(file.name) || file.type === "text/csv"

/**
 * The reading half of an import. `onText` turns the text into a review (or a message); it gets the
 * attempt number of the read so a result for an older pick is dropped (compare with `attempt`).
 */
export function useStatementReader<R>({
  onText,
  cannotRead,
  wrongPassword,
  csv = false,
}: {
  onText: (read: StatementText) => Promise<void>
  cannotRead: () => FilePhase<R>
  wrongPassword: string
  /** Also take CSV files (bank statements): read as text on this device, no password. */
  csv?: boolean
}) {
  const [phase, setPhase] = useState<FilePhase<R>>({ step: "choose" })
  const [password, setPassword] = useState("")
  const file = useRef<File | null>(null)
  // The statement's text and row positions; they never leave this page.
  const read = useRef<StatementText | null>(null)
  // Each pick (and each read or re-review) gets a number; a result for an older one is dropped.
  const attempt = useRef(0)

  const open = async (pdf: File, pass?: string) => {
    const id = ++attempt.current
    setPhase({ step: "reading" })
    try {
      const lib = await loadPdfjs()
      const result = await readStatementPdf(lib, new Uint8Array(await pdf.arrayBuffer()), pass)
      if (id !== attempt.current) return
      if (result.status === "ok") {
        read.current = { text: result.text, format: "pdf", pageRowCounts: result.pageRowCounts, rowLayouts: result.rowLayouts, rows: result.rows }
        await onText(read.current)
      } else if (result.status === "needs_password") setPhase({ step: "password" })
      else if (result.status === "wrong_password") setPhase({ step: "password", message: wrongPassword })
      else if (result.status === "no_text" || result.status === "unreadable") setPhase(cannotRead())
      else setPhase({ step: "choose", message: PDF_READ_MESSAGES[result.status] })
    } catch {
      if (id === attempt.current) setPhase(cannotRead())
    } finally {
      setPassword("")
    }
  }

  const openCsv = async (picked: File) => {
    const id = ++attempt.current
    setPhase({ step: "reading" })
    try {
      const text = await picked.text()
      if (id !== attempt.current) return
      read.current = { text, format: "csv" }
      await onText(read.current)
    } catch {
      if (id === attempt.current) setPhase(cannotRead())
    }
  }

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null
    e.target.value = ""
    // A new pick (or a cleared input) drops everything from the previous file at once: its review
    // (lines, notices, ticks, statement fields, any open confirm), its text and the password.
    attempt.current++
    read.current = null
    file.current = null
    setPassword("")
    setPhase({ step: "choose" })
    if (!picked) return
    const asCsv = csv && isCsv(picked)
    if (!asCsv && !/\.pdf$/i.test(picked.name) && picked.type !== "application/pdf")
      return setPhase({ step: "choose", message: csv ? "Choose a PDF or CSV file." : "Choose a PDF file." })
    if (picked.size > MAX_STATEMENT_PDF_BYTES) return setPhase({ step: "choose", message: PDF_READ_MESSAGES.too_large })
    file.current = picked
    void (asCsv ? openCsv(picked) : open(picked))
  }

  const openWithPassword = (e: React.FormEvent) => {
    e.preventDefault()
    if (file.current && password !== "") void open(file.current, password)
  }

  return { phase, setPhase, password, setPassword, choose, openWithPassword, readRef: read, attemptRef: attempt, busy: phase.step === "reading" || phase.step === "matching" }
}

/** The file picker and the reading, password and message steps. `children`: extra content of a message (e.g. a parser offer). */
export function StatementFileSection<R>({
  label,
  reader,
  onRetry,
  messageExtra,
  csv = false,
}: {
  label: string
  reader: ReturnType<typeof useStatementReader<R>>
  onRetry: () => void
  messageExtra?: React.ReactNode
  /** The picker also takes CSV files. */
  csv?: boolean
}) {
  const { phase, password, setPassword, choose, openWithPassword, busy } = reader
  return (
    <section aria-labelledby="pdf-heading" className="grid gap-3 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <h2 id="pdf-heading" className="text-base font-semibold">
        {csv ? "Statement file" : "Statement PDF"}
      </h2>
      <div className="grid gap-1.5">
        <label htmlFor="statement-pdf" className="text-sm font-semibold text-ink">
          {label}
        </label>
        <input
          id="statement-pdf"
          type="file"
          accept={csv ? "application/pdf,.pdf,text/csv,.csv" : "application/pdf,.pdf"}
          aria-describedby="statement-pdf-hint"
          onChange={choose}
          disabled={busy}
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-semibold"
        />
        <p id="statement-pdf-hint" className="text-xs text-muted-foreground">
          Read on this device only: the file and any password are never uploaded or saved. {csv ? "Text PDFs or CSV files" : "Text PDFs"} from your
          bank, up to {MAX_STATEMENT_PDF_BYTES / 1024 / 1024} MB.
        </p>
      </div>
      {phase.step === "choose" && phase.message && <FormMessage tone="error">{phase.message}</FormMessage>}
      {phase.step === "reading" && <FormMessage tone="info">Reading the statement…</FormMessage>}
      {phase.step === "matching" && <FormMessage tone="info">Checking it against your entries…</FormMessage>}
      {phase.step === "message" && (
        <FormMessage tone="error">
          {phase.text}
          {phase.pnbOffer && messageExtra}
        </FormMessage>
      )}
      {phase.step === "match_failed" && (
        <FormMessage tone="error">
          We couldn&apos;t check this statement against your entries. Check your connection.{" "}
          <button type="button" className="font-semibold underline underline-offset-4" onClick={onRetry}>
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
  )
}

/** "Check this statement": the reasons and the confirm Save waits for. Nothing is unticked. */
export function CheckAlert({ reasons, confirmed, onConfirm }: { reasons: string[]; confirmed: boolean; onConfirm: (v: boolean) => void }) {
  if (reasons.length === 0) return null
  return (
    <div role="alert" className="grid gap-2 rounded-xl bg-chip-peach px-3 py-2.5 text-sm text-danger">
      <p className="font-semibold">Check this statement</p>
      <ul className="grid list-disc gap-1 pl-5">
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <label className="flex items-start gap-2 font-semibold text-ink">
        <input type="checkbox" className="mt-0.5 size-4 accent-(--color-ink)" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} />
        I have compared these lines with my PDF
      </label>
    </div>
  )
}

export function SkippedNotice({ count, totalMinor, reasons, currency }: { count: number; totalMinor: number; reasons: string[]; currency: string }) {
  if (count === 0) return null
  return (
    <FormMessage tone="info">
      {count === 1 ? "1 line is skipped" : `${count} lines are skipped`} ({money(totalMinor, currency)}): {reasons.join(", ")}. Each is marked below.
    </FormMessage>
  )
}

const MAX_UNREADABLE_SHOWN = 10

/** Rows the reader couldn't use: where each is and its masked shape, and Copy layout (no text or digits). */
export function UnreadableNotice({ count, rows }: { count: number; rows: UnreadableRow[] }) {
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null)
  if (count === 0) return null
  return (
    <FormMessage tone="error">
      {count === 1 ? "1 row could not be read" : `${count} rows could not be read`}. Compare the lines with your PDF.
      {rows.length > 0 && (
        <ul aria-label="Rows that could not be read" className="mt-1 list-disc pl-5">
          {rows.slice(0, MAX_UNREADABLE_SHOWN).map((u, i) => (
            <li key={i}>
              {u.page === null ? `Row ${u.row}` : `Page ${u.page}, row ${u.row}`}
              {u.shape && `: ${u.shape}`}
            </li>
          ))}
          {rows.length > MAX_UNREADABLE_SHOWN && <li>and {rows.length - MAX_UNREADABLE_SHOWN} more</li>}
        </ul>
      )}
      {rows.length > 0 && (
        <span className="mt-2 flex flex-wrap items-center gap-2">
          {/* For support: where each unreadable piece sits, never its text or digits. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              void navigator.clipboard
                .writeText(unreadableLayoutText(rows))
                .then(() => setCopied("copied"))
                .catch(() => setCopied("failed"))
            }
          >
            Copy layout
          </Button>
          <span role="status" className="text-sm">
            {copied === "copied"
              ? "Layout copied: positions and sizes only, no text or numbers from your statement."
              : copied === "failed"
                ? "Couldn't copy. Allow clipboard access and try again."
                : ""}
          </span>
        </span>
      )}
    </FormMessage>
  )
}

const STATUS_BADGE: Partial<Record<string, { text: string; tone: "info" | "neutral" }>> = {
  duplicate: { text: "Possible duplicate", tone: "info" },
  imported: { text: "Already imported", tone: "neutral" },
  deleted: { text: "Already imported (deleted)", tone: "neutral" },
}

const RESULT_BADGE: Record<Exclude<LineSaveResult["status"], "failed">, { text: string; tone: "positive" | "neutral" }> = {
  saved: { text: "Saved", tone: "positive" },
  already_saved: { text: "Already imported", tone: "neutral" },
  deleted: { text: "Already imported (deleted)", tone: "neutral" },
}

/** The head of a review line: its tick (when tickable), description, amount, date and notes, status badge and save result. */
export function LineHead({
  name,
  description,
  amountMinor,
  direction,
  date,
  currency,
  notes,
  status,
  result,
  tickable,
  ticked,
  onTick,
}: {
  /** "<description>, <date>": names the line's controls. */
  name: string
  description: string
  amountMinor: number
  direction: "debit" | "credit"
  date: string
  currency: string
  notes: (string | false | null | undefined)[]
  status: string
  result: LineSaveResult | undefined
  tickable: boolean
  ticked: boolean
  onTick: (ticked: boolean) => void
}) {
  const badge = result && result.status !== "failed" ? RESULT_BADGE[result.status] : STATUS_BADGE[status]
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      {tickable ? (
        <input type="checkbox" aria-label={`Import ${name}`} className="mt-0.5 size-4 accent-(--color-ink)" checked={ticked} onChange={(e) => onTick(e.target.checked)} />
      ) : (
        <span aria-hidden="true" className="mt-0.5 size-4" />
      )}
      <span className="min-w-0 flex-1 text-sm font-semibold break-words">{description}</span>
      <span className="text-sm font-semibold tabular-nums">
        {money(amountMinor, currency)} {direction === "credit" ? "Cr" : "Dr"}
      </span>
      <span className="basis-full pl-7 text-xs text-muted-foreground">
        {fullDate(date)}
        {notes.filter(Boolean).map((n) => ` · ${n}`)}
      </span>
      {badge && (
        <span className="pl-7">
          <Badge tone={badge.tone}>{badge.text}</Badge>
        </span>
      )}
      {result?.status === "failed" && <span className="basis-full pl-7 text-xs font-semibold text-danger">Not saved: {result.reason}</span>}
    </div>
  )
}

export { type SaveOutcome, lineText, saveInChunks, savedOutcome } from "./save-chunks"
