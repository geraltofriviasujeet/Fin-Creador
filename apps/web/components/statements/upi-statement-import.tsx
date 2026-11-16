"use client"

import { useEffect, useRef, useState } from "react"
import {
  type LineSaveResult,
  UPI_CATEGORY_SOURCE_LABELS,
  UPI_SKIP_TEXT,
  type UpiAccountMatch,
  type UpiAccountNeed,
  type UpiImportLoad,
  type UpiImportOptions,
  type UpiLineType,
  type UpiMatches,
  type UpiReview,
  type UpiReviewLine,
  answerDuplicates,
  buildUpiReview,
  canTickUpi,
  matchedAccount,
  namesToSuggest,
  payeeKey,
  reviewPage,
  setUpiLineType,
  upiAccountsNeeded,
  upiCheckReasons,
  upiLineErrors,
  upiLiteChoice,
  upiLiteNeeded,
  upiMatchRange,
  upiPayees,
  upiReviewKeys,
  upiReviewTotals,
} from "@fin-creador/api"
import {
  MAX_UPI_PDF_BYTES,
  MAX_UPI_PDF_PAGES,
  MAX_UPI_PERIOD_DAYS,
  UPI_APP_NAMES,
  type UpiStatementParse,
  readUpiStatement,
  upiPeriodDays,
  upiReadFailureText,
} from "@fin-creador/domain"
import { type CategorySlot, IMPORT_SAVE_CHUNK } from "@fin-creador/schemas"
import {
  chooseUpiLiteAction,
  saveUpiAccountMatchAction,
  saveUpiImportLinesAction,
  setImportPayeesConsentAction,
  suggestUpiCategoriesAction,
  upiHistoryAction,
  upiMatchesAction,
} from "@/app/(app)/income/import/upi/actions"
import { fullDate, money } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { FormMessage } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { RULES_ONLY_TEXT, type RulesOnlyReason } from "@/lib/ai/import-categories-text"
import { PDF_READ_MESSAGES } from "@/lib/statements/pdf-reader"
import { CheckAlert, LineHead, type SaveOutcome, type StatementText, StatementFileSection, UnreadableNotice, lineText, saveInChunks, savedOutcome, useStatementReader } from "./statement-shared"

// UPI app statement import (Sprint 9e). The PDF is read on this device (the existing reader, with
// UPI caps: 25 MB, 250 pages); the layout is picked from its header. Then, in order: match each bank
// account the statement names to one of the person's accounts (remembered), the Google Pay UPI
// Lite choice (once), the lookups (what is already imported, entries for possible duplicates, the
// person's own payee history), consent before payee names are first sent for category suggestions
// (once; "Not now" imports with rules only), the suggestions, then ONE dialog with every possible
// duplicate beside the entry it may repeat, and the review. Nothing is saved until the person
// confirms; payments are saved in chunks, each on its own.

type Load = Extract<UpiImportLoad, { ok: true }>
type ReadPhase = { parse: UpiStatementParse; read: StatementText; id: number }

const UNREADABLE =
  "We couldn't read this file as a Paytm, PhonePe, BHIM or Google Pay statement. We read the text PDF the app gives you; scanned or photographed statements can't be read. Your file was read on this device only and wasn't saved or uploaded. You can still add entries by hand."
const TOO_LONG = `This statement covers more than ${MAX_UPI_PERIOD_DAYS} days. Download one for a year or less and try again.`
const PAGE = 100

export function UpiStatementImport({ load, suggestionsOn }: { load: Load; suggestionsOn: boolean }) {
  const reader: ReturnType<typeof useStatementReader<ReadPhase>> = useStatementReader<ReadPhase>({
    onText: (): Promise<void> => readIt(),
    cannotRead: () => ({ step: "message", text: UNREADABLE, pnbOffer: false }),
    wrongPassword: PDF_READ_MESSAGES.wrong_password,
    limits: { bytes: MAX_UPI_PDF_BYTES, pages: MAX_UPI_PDF_PAGES },
  })
  const { phase, setPhase, attemptRef } = reader

  async function readIt(): Promise<void> {
    const read = reader.readRef.current
    if (read === null) return
    const parse = readUpiStatement(read)
    if (!parse) return void setPhase({ step: "message", text: UNREADABLE, pnbOffer: false, layout: upiReadFailureText(read) })
    const days = upiPeriodDays(parse.period)
    if (days !== null && days > MAX_UPI_PERIOD_DAYS) return void setPhase({ step: "message", text: TOO_LONG, pnbOffer: false })
    setPhase({ step: "review", parse, read, id: attemptRef.current })
  }

  return (
    <div className="grid gap-4">
      <StatementFileSection label="Choose your UPI app statement (PDF)" reader={reader} onRetry={() => void readIt()} from="your UPI app" />
      {phase.step === "review" && <UpiFlow key={phase.id} load={load} parse={phase.parse} read={phase.read} suggestionsOn={suggestionsOn} />}
    </div>
  )
}

type Stage =
  | { name: "accounts" }
  | { name: "lite" }
  | { name: "loading" }
  | { name: "consent"; names: { id: string; name: string }[] }
  | { name: "suggesting" }
  | { name: "failed" }
  | { name: "review"; review: UpiReview; note: string | null }

function UpiFlow({ load, parse, read, suggestionsOn }: { load: Load; parse: UpiStatementParse; read: StatementText; suggestionsOn: boolean }) {
  const [options, setOptions] = useState<UpiImportOptions>(load.options)
  const [matches, setMatches] = useState<UpiAccountMatch[]>(load.matches)
  const [consentAt, setConsentAt] = useState(load.consentAt)
  const looked = useRef<{ history: Map<string, string>; existing: UpiMatches } | null>(null)
  const needs = upiAccountsNeeded(parse)
  const unmatched = (m: readonly UpiAccountMatch[], o: UpiImportOptions) =>
    needs.filter((n) => matchedAccount(m, o, parse.app, { bankLabel: n.label, digits: n.digits }) === null)
  const firstStage = (m: readonly UpiAccountMatch[], o: UpiImportOptions): Stage =>
    unmatched(m, o).length > 0 ? { name: "accounts" } : upiLiteNeeded(parse) && upiLiteChoice(m, o) === undefined ? { name: "lite" } : { name: "loading" }
  const [stage, setStage] = useState<Stage>(() => firstStage(load.matches, load.options))
  const [asked, setAsked] = useState(false)

  const build = (m: readonly UpiAccountMatch[], o: UpiImportOptions, suggestions: Map<string, CategorySlot>, note: string | null) => {
    const data = looked.current!
    const review = buildUpiReview(parse, {
      matches: m,
      options: o,
      existing: data.existing,
      history: data.history,
      suggestions,
      context: { today: load.today, currency: load.currency },
      pageRowCounts: read.pageRowCounts,
      rowLayouts: read.rowLayouts,
    })
    setStage({ name: "review", review, note })
  }

  const suggest = async (m: readonly UpiAccountMatch[], o: UpiImportOptions, names: { id: string; name: string }[]) => {
    setStage({ name: "suggesting" })
    const result = await suggestUpiCategoriesAction({ names }).catch(() => null)
    const byKey = new Map<string, CategorySlot>()
    for (const n of names) {
      const slot = result?.suggestions[n.id]
      if (slot) byKey.set(payeeKey(n.name), slot)
    }
    const reason: RulesOnlyReason | null = result ? result.rulesOnly : "failed"
    build(m, o, byKey, reason ? RULES_ONLY_TEXT[reason] : null)
  }

  /** The lookups, then consent or suggestions when the rules leave names without a category, then the review. */
  const lookUp = async (m: readonly UpiAccountMatch[], o: UpiImportOptions) => {
    setStage({ name: "loading" })
    const accountIds = [...new Set(needs.map((n) => matchedAccount(m, o, parse.app, { bankLabel: n.label, digits: n.digits })).filter((id): id is string => !!id))]
    const lite = upiLiteChoice(m, o)
    if (lite) accountIds.push(lite)
    const range = upiMatchRange(parse, load.today)
    const [history, existing] = await Promise.all([
      upiHistoryAction(upiPayees(parse).slice(0, 2_000)).catch(() => null),
      upiMatchesAction({ keys: upiReviewKeys(parse), accountIds, from: range.from, to: range.to }).catch(() => null),
    ])
    if (!history?.ok || !existing?.ok) return setStage({ name: "failed" })
    looked.current = { history: new Map(history.history), existing: existing.matches }
    const names = namesToSuggest(parse, o.expenseCategories, looked.current.history)
    if (names.length === 0 || !suggestionsOn) return build(m, o, new Map(), names.length > 0 ? RULES_ONLY_TEXT.off : null)
    if (consentAt === null) return setStage({ name: "consent", names })
    await suggest(m, o, names)
  }

  useEffect(() => {
    if (stage.name === "loading" && looked.current === null && !asked) {
      setAsked(true)
      void lookUp(matches, options)
    }
    // Runs once, when the flow starts at the lookups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const header = (
    <p className="text-sm text-muted-foreground">
      {UPI_APP_NAMES[parse.app]} statement
      {parse.period.from && parse.period.to ? `, ${fullDate(parse.period.from)} to ${fullDate(parse.period.to)}` : ""} · {parse.rows.length} payments read
    </p>
  )

  switch (stage.name) {
    case "accounts":
      return (
        <AccountsStep
          header={header}
          app={parse.app}
          needs={unmatched(matches, options)}
          options={options}
          onDone={(saved) => {
            const next = [...matches, ...saved]
            setMatches(next)
            const s = firstStage(next, options)
            if (s.name === "lite") setStage(s)
            else void lookUp(next, options)
          }}
        />
      )
    case "lite":
      return (
        <LiteStep
          header={header}
          openingDate={parse.rows.filter((r) => r.viaLite || r.kind === "lite_topup").map((r) => r.date).sort()[0] ?? load.today}
          onDone={(match, account) => {
            const next = [...matches.filter((x) => x.kind !== "upi_lite"), match]
            const nextOptions = account ? { ...options, accounts: [...options.accounts, { ...account, kind: "other" }] } : options
            setMatches(next)
            setOptions(nextOptions)
            void lookUp(next, nextOptions)
          }}
        />
      )
    case "loading":
    case "suggesting":
      return (
        <section className="grid gap-2 rounded-2xl border border-line bg-surface p-4 md:p-5" aria-busy="true">
          {header}
          <FormMessage tone="info">{stage.name === "loading" ? "Checking it against your entries…" : "Suggesting categories…"}</FormMessage>
        </section>
      )
    case "failed":
      return (
        <section className="grid gap-2 rounded-2xl border border-line bg-surface p-4 md:p-5">
          {header}
          <FormMessage tone="error">
            We couldn&apos;t check this statement against your entries. Check your connection.{" "}
            <button type="button" className="font-semibold underline underline-offset-4" onClick={() => void lookUp(matches, options)}>
              Try again
            </button>
          </FormMessage>
        </section>
      )
    case "consent":
      return (
        <ConsentStep
          header={header}
          count={stage.names.length}
          onAllow={async () => {
            const result = await setImportPayeesConsentAction(true).catch(() => null)
            if (result?.ok) {
              setConsentAt(result.at)
              await suggest(matches, options, stage.names)
            } else build(matches, options, new Map(), "We couldn't save your answer, so categories come from rules only.")
          }}
          onNotNow={() => build(matches, options, new Map(), RULES_ONLY_TEXT.no_consent)}
        />
      )
    case "review":
      return <UpiReviewSection key="review" header={header} initial={stage.review} note={stage.note} options={options} today={load.today} currency={load.currency} />
  }
}

const needLabel = (n: UpiAccountNeed) => `${n.label || "Account"} ··${n.digits}`

function AccountsStep({
  header,
  app,
  needs,
  options,
  onDone,
}: {
  header: React.ReactNode
  app: UpiStatementParse["app"]
  needs: UpiAccountNeed[]
  options: UpiImportOptions
  onDone: (saved: UpiAccountMatch[]) => void
}) {
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = (n: UpiAccountNeed) => `${n.bankLabel}|${n.digits}`
  const answered = needs.every((n) => choice[id(n)])

  const save = async () => {
    setSaving(true)
    setError(null)
    const saved: UpiAccountMatch[] = []
    for (const n of needs) {
      const accountId = choice[id(n)]
      if (!accountId || accountId === "skip") continue
      const result = await saveUpiAccountMatchAction({ kind: "bank", app, bankLabel: n.label, digits: n.digits, accountId }).catch(() => null)
      if (!result?.ok) {
        setSaving(false)
        return setError(result?.message ?? "We couldn't save this. Check your connection and try again.")
      }
      saved.push(result.match)
    }
    onDone(saved)
  }

  return (
    <section aria-labelledby="accounts-heading" className="grid gap-4 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <h2 id="accounts-heading" className="text-base font-semibold">
        Which of your accounts are these?
      </h2>
      {header}
      <p className="text-sm">
        The statement names {needs.length === 1 ? "an account" : "these accounts"} by bank and last digits. Choose yours once; we remember it for your next
        statement. Payments on an account you skip aren&apos;t imported.
      </p>
      {options.accounts.length === 0 && <FormMessage tone="error">Add your bank account on the Income page first.</FormMessage>}
      <ul className="grid gap-3">
        {needs.map((n) => (
          <li key={id(n)} className="grid gap-1.5 md:grid-cols-[1fr_16rem] md:items-center">
            <label htmlFor={`acct-${id(n)}`} className="text-sm font-semibold">
              {needLabel(n)} <span className="font-normal text-muted-foreground">({n.payments === 1 ? "1 payment" : `${n.payments} payments`})</span>
            </label>
            <NativeSelect id={`acct-${id(n)}`} aria-label={`Account for ${needLabel(n)}`} value={choice[id(n)] ?? ""} onChange={(e) => setChoice((c) => ({ ...c, [id(n)]: e.target.value }))}>
              <option value="">Choose the account</option>
              {options.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="skip">Not one of mine: skip its payments</option>
            </NativeSelect>
          </li>
        ))}
      </ul>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div>
        <Button disabled={!answered || saving} aria-busy={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Continue"}
        </Button>
      </div>
    </section>
  )
}

function LiteStep({
  header,
  openingDate,
  onDone,
}: {
  header: React.ReactNode
  openingDate: string
  onDone: (match: UpiAccountMatch, account: { id: string; name: string; openingBalanceDate: string } | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const choose = async (create: boolean) => {
    setBusy(true)
    setError(null)
    const result = await chooseUpiLiteAction({ create, openingDate }).catch(() => null)
    setBusy(false)
    if (!result?.ok) return setError(result?.message ?? "We couldn't save this. Check your connection and try again.")
    onDone(result.match, create ? result.account : null)
  }
  return (
    <section aria-labelledby="lite-heading" className="grid gap-4 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <h2 id="lite-heading" className="text-base font-semibold">
        Add a UPI Lite account?
      </h2>
      {header}
      <p className="text-sm">
        This statement has UPI Lite payments. A top-up moves money from your bank into UPI Lite; Lite payments are then spent from UPI Lite, not
        straight from your bank. With a UPI Lite account, each top-up is saved as a transfer into it and each Lite payment as an expense from it.
      </p>
      <p className="text-sm text-muted-foreground">
        Without one, Lite payments are saved from your bank account and top-ups are skipped, so the same money is never counted twice. We ask once.
      </p>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void choose(true)}>
          Add UPI Lite account
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void choose(false)}>
          No, use my bank account
        </Button>
      </div>
    </section>
  )
}

function ConsentStep({ header, count, onAllow, onNotNow }: { header: React.ReactNode; count: number; onAllow: () => Promise<void>; onNotNow: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <section aria-labelledby="consent-heading" className="grid gap-4 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <h2 id="consent-heading" className="text-base font-semibold">
        Suggest categories with Claude?
      </h2>
      {header}
      <p className="text-sm">
        {count === 1 ? "1 payee isn't" : `${count} payees aren't`} covered by your history or our merchant list. To suggest categories, payee names from
        this statement (for example a shop&apos;s name) are sent to Anthropic. Amounts, dates, account details and your name are never sent.
      </p>
      <p className="text-sm text-muted-foreground">
        &quot;Allow&quot; is remembered and can be withdrawn in Settings. &quot;Not now&quot; imports this statement with rules only and asks again next time.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            setBusy(true)
            void onAllow()
          }}
        >
          Allow
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onNotNow}>
          Not now
        </Button>
      </div>
    </section>
  )
}

type Filter = "all" | "choice" | "ticked" | "duplicates"
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All payments" },
  { value: "choice", label: "Need a choice" },
  { value: "ticked", label: "Ticked" },
  { value: "duplicates", label: "Possible duplicates" },
]
const shownFor = (lines: readonly UpiReviewLine[], f: Filter) =>
  lines
    .map((line, index) => ({ line, index }))
    .filter(({ line: l }) =>
      f === "all" ? true : f === "ticked" ? l.ticked : f === "duplicates" ? l.status === "duplicate" : (l.status === "new" || l.status === "duplicate") && l.type === "",
    )

function UpiReviewSection({
  header,
  initial,
  note,
  options,
  today,
  currency,
}: {
  header: React.ReactNode
  initial: UpiReview
  note: string | null
  options: UpiImportOptions
  today: string
  currency: string
}) {
  const [lines, setLines] = useState(initial.lines)
  const dupCount = initial.lines.filter((l) => l.status === "duplicate").length
  const [dupsAnswered, setDupsAnswered] = useState(dupCount === 0)
  const [dupsOpen, setDupsOpen] = useState(dupCount > 0)
  const [checkConfirmed, setCheckConfirmed] = useState(false)
  const [filter, setFilter] = useState<Filter>("all")
  const [page, setPage] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<Record<string, LineSaveResult>>({})
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null)
  const context = { today, currency }
  const totals = upiReviewTotals(lines, currency)
  const reasons = upiCheckReasons(initial.checks, currency)
  const accountName = (id: string) => options.accounts.find((a) => a.id === id)?.name ?? ""
  const ticked = lines.filter((l) => l.ticked)
  const errors = ticked.some((l) => Object.keys(upiLineErrors(l, options, context)).length > 0)
  const blocked = !dupsAnswered || ticked.length === 0 || errors || (reasons.length > 0 && !checkConfirmed)

  const change = (i: number, patch: Partial<UpiReviewLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const shown = shownFor(lines, filter)
  const { current, pages, from, to } = reviewPage(shown.length, page, PAGE)

  const save = async () => {
    setConfirming(false)
    setSaving(true)
    setOutcome(null)
    const { done, stopped } = await saveInChunks(
      ticked,
      IMPORT_SAVE_CHUNK,
      (chunk) =>
        saveUpiImportLinesAction({
          lines: chunk.map((l) => ({
            original: { ref: l.original.ref, direction: l.original.direction, date: l.original.date, amountMinor: l.original.amountMinor, payee: l.original.payee },
            type: l.type,
            date: l.date,
            amount: l.amount,
            accountId: l.accountId,
            counterAccountId: l.type === "transfer" ? l.counterAccountId : "",
            categoryId: l.type === "transfer" ? "" : l.categoryId,
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
        setOutcome({ tone: "info", text: `Saving… ${lineText(byKey.size)} more done.` })
      },
    )
    setOutcome(savedOutcome(ticked.length, done, stopped))
    setSaving(false)
  }

  return (
    <section aria-labelledby="review-heading" className="grid gap-4 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <h2 id="review-heading" className="text-base font-semibold">
        Review the payments
      </h2>
      {header}
      {note && <FormMessage tone="info">{note}</FormMessage>}
      <CheckAlert reasons={reasons} confirmed={checkConfirmed} onConfirm={setCheckConfirmed} />
      <SkipSummary skipped={totals.skipped} />
      <UnreadableNotice count={initial.unreadableRows} rows={initial.unreadable} />
      {totals.needChoice > 0 && (
        <FormMessage tone="info">
          {totals.needChoice === 1 ? "1 payment received needs" : `${totals.needChoice} payments received need`} a choice: income, a refund or skip. Nothing is
          saved until you tick it.
        </FormMessage>
      )}
      {dupCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{dupCount === 1 ? "1 possible duplicate" : `${dupCount} possible duplicates`}{dupsAnswered ? " answered." : " to answer before saving."}</span>
          <Button variant="secondary" size="sm" onClick={() => setDupsOpen(true)}>
            Review possible duplicates
          </Button>
        </div>
      )}

      <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <label key={f.value} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm has-checked:border-ink has-checked:font-semibold">
            <input
              type="radio"
              name="upi-filter"
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
        <p className="text-sm text-muted-foreground">No payments were found in this statement.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payments to show here.</p>
      ) : (
        <ul aria-label="Payments" className="grid gap-2">
          {shown.slice(from, to).map(({ line, index }) => (
            <UpiRowItem key={line.key} line={line} result={results[line.key]} options={options} context={context} accountName={accountName} onChange={(p) => change(index, p)} />
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Pages of payments" className="flex flex-wrap items-center gap-3 text-sm">
          <Button variant="secondary" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </Button>
          <span className="tabular-nums">
            Payments {from + 1}–{to} of {shown.length}
          </span>
          <Button variant="secondary" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next
          </Button>
        </nav>
      )}

      <p className="text-sm font-semibold tabular-nums" aria-live="polite">
        Ticked: {lineText(totals.ticked)} · Money out {money(totals.outMinor, currency)} · Money in {money(totals.inMinor, currency)}
      </p>
      <div className="grid gap-2">
        {!dupsAnswered && <p className="text-xs text-danger">Answer the possible duplicates first.</p>}
        {errors && <p className="text-xs text-danger">Fix the highlighted payments.</p>}
        {outcome && outcome.text && <FormMessage tone={outcome.tone}>{outcome.text}</FormMessage>}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={blocked || saving} aria-busy={saving} onClick={() => setConfirming(true)}>
            {saving ? "Saving…" : "Save ticked payments"}
          </Button>
          <span className="text-xs text-muted-foreground">Nothing is saved until you confirm.</span>
        </div>
      </div>

      <DuplicatesDialog
        open={dupsOpen}
        lines={lines.filter((l) => l.status === "duplicate")}
        currency={currency}
        accountName={accountName}
        onClose={() => setDupsOpen(false)}
        onAnswer={(keys) => {
          setLines((ls) => answerDuplicates(answerDuplicates(ls, "add", keys.add), "skip", keys.skip))
          setDupsAnswered(true)
          setDupsOpen(false)
        }}
      />

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent eyebrow="UPI statement" title="Save these payments?">
          <div className="grid gap-3 text-sm">
            <p className="font-semibold">
              {lineText(ticked.length)}: money out {money(totals.outMinor, currency)}, money in {money(totals.inMinor, currency)}.
            </p>
            {ticked.some((l) => l.type === "transfer") && <p>Transfers move money between your own accounts: they are neither income nor expenses.</p>}
            {ticked.some((l) => l.type === "refund") && <p>Refunds lower their category&apos;s spending; they aren&apos;t income.</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
              <Button type="button" onClick={() => void save()}>
                Save {lineText(ticked.length)}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function SkipSummary({ skipped }: { skipped: Partial<Record<keyof typeof UPI_SKIP_TEXT, number>> }) {
  const parts = (Object.entries(skipped) as [keyof typeof UPI_SKIP_TEXT, number][]).filter(([, n]) => n > 0)
  if (parts.length === 0) return null
  const text: Record<keyof typeof UPI_SKIP_TEXT, (n: number) => string> = {
    failed: (n) => `${n} failed`,
    pending: (n) => `${n} pending`,
    unmatched: (n) => `${n} on an account you didn't match`,
    lite_topup: (n) => `${n} UPI Lite ${n === 1 ? "top-up" : "top-ups"} (Lite payments are saved from your bank instead)`,
    before_account: (n) => `${n} before the account's opening balance date`,
    future: (n) => `${n} dated in the future`,
  }
  return <FormMessage tone="info">Not imported: {parts.map(([k, n]) => text[k](n)).join(", ")}. Each is marked below.</FormMessage>
}

function UpiRowItem({
  line,
  result,
  options,
  context,
  accountName,
  onChange,
}: {
  line: UpiReviewLine
  result: LineSaveResult | undefined
  options: UpiImportOptions
  context: { today: string; currency: string }
  accountName: (id: string) => string
  onChange: (patch: Partial<UpiReviewLine>) => void
}) {
  const { original } = line
  const description =
    original.kind === "self_transfer" ? "Self transfer" : original.kind === "lite_topup" ? "UPI Lite top-up" : original.payee || "No payee name"
  const name = `${description}, ${fullDate(original.date)}`
  const open = line.status === "new" || line.status === "duplicate"
  const tickable = canTickUpi(line)
  const errors = line.ticked ? upiLineErrors(line, options, context) : {}
  const received = original.kind === "received"
  const where =
    line.type === "transfer"
      ? `${accountName(line.accountId)} to ${accountName(line.counterAccountId)}`
      : line.accountId
        ? accountName(line.accountId)
        : ""
  const categories = line.type === "income" ? options.incomeSources : options.expenseCategories

  return (
    <li className="grid gap-2 rounded-xl border border-line px-3 py-2.5">
      <LineHead
        name={name}
        description={description}
        amountMinor={original.amountMinor}
        direction={original.direction}
        date={original.date}
        currency={context.currency}
        notes={[where, line.skipReason && UPI_SKIP_TEXT[line.skipReason], original.viaLite && "paid from UPI Lite"]}
        status={line.status}
        result={result}
        tickable={tickable}
        ticked={line.ticked}
        onTick={(ticked) => onChange({ ticked })}
      />
      {open && (
        <div className="grid gap-2 pl-7 md:grid-cols-[14rem_1fr]">
          {received && (
            <div className="grid gap-1">
              <NativeSelect
                aria-label={`What is ${name}`}
                value={line.type}
                aria-invalid={errors.type ? true : undefined}
                onChange={(e) => onChange(setUpiLineType(line, e.target.value as UpiLineType | ""))}
              >
                <option value="">Choose what this is</option>
                <option value="income">Income</option>
                <option value="refund">Refund</option>
                <option value="skip">Skip</option>
              </NativeSelect>
              {errors.type && <span className="text-xs text-danger">{errors.type}</span>}
            </div>
          )}
          {line.type !== "" && line.type !== "skip" && line.type !== "transfer" && (
            <div className="grid gap-1">
              <NativeSelect
                aria-label={`${line.type === "income" ? "Income source" : "Category"} for ${name}`}
                value={line.categoryId}
                aria-invalid={errors.category ? true : undefined}
                onChange={(e) => onChange({ categoryId: e.target.value, categorySource: null })}
              >
                <option value="">{line.type === "income" ? "Choose an income source" : "Choose a category"}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              {errors.category && <span className="text-xs text-danger">{errors.category}</span>}
              {line.categorySource && (
                <span className="text-xs text-muted-foreground">
                  <Badge tone="neutral">{UPI_CATEGORY_SOURCE_LABELS[line.categorySource]}</Badge>
                </span>
              )}
            </div>
          )}
          {errors.account && <span className="text-xs text-danger md:col-span-2">{errors.account}</span>}
        </div>
      )}
      {tickable && line.ticked && (
        <div className="grid gap-2 pl-7 md:grid-cols-[10rem_9rem]">
          <div className="grid gap-1">
            <Input
              type="date"
              aria-label={`Date for ${name}`}
              value={line.date}
              max={context.today}
              aria-invalid={errors.date ? true : undefined}
              onChange={(e) => onChange({ date: e.target.value })}
            />
            {errors.date && <span className="text-xs text-danger">{errors.date}</span>}
          </div>
          <div className="grid gap-1">
            <Input inputMode="decimal" aria-label={`Amount for ${name}`} value={line.amount} aria-invalid={errors.amount ? true : undefined} onChange={(e) => onChange({ amount: e.target.value })} />
            {errors.amount && <span className="text-xs text-danger">{errors.amount}</span>}
          </div>
        </div>
      )}
    </li>
  )
}

/** Every possible duplicate in one dialog, each beside the entry it may repeat: Add all, Skip all, or a choice per payment. */
function DuplicatesDialog({
  open,
  lines,
  currency,
  accountName,
  onClose,
  onAnswer,
}: {
  open: boolean
  lines: UpiReviewLine[]
  currency: string
  accountName: (id: string) => string
  onClose: () => void
  onAnswer: (keys: { add: Set<string>; skip: Set<string> }) => void
}) {
  const [choice, setChoice] = useState<Record<string, "add" | "skip">>({})
  const all = (a: "add" | "skip") => {
    const keys = new Set(lines.map((l) => l.key))
    onAnswer(a === "add" ? { add: keys, skip: new Set() } : { add: new Set(), skip: keys })
  }
  const answered = lines.every((l) => choice[l.key])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        eyebrow="Before anything is added"
        title={lines.length === 1 ? "1 payment may already be recorded" : `${lines.length} payments may already be recorded`}
        description="Each has the same account, amount and direction as an entry you already have, within a day either side (a late payment can post the next day)."
        className="max-w-2xl"
      >
        <div className="grid gap-3 text-sm">
          <ul aria-label="Possible duplicates" className="grid max-h-[50vh] gap-2 overflow-y-auto">
            {lines.map((l) => {
              const e = l.duplicateOf!
              const label = l.original.payee || (l.original.kind === "self_transfer" ? "Self transfer" : "UPI Lite top-up")
              return (
                <li key={l.key} className="grid gap-2 rounded-xl border border-line p-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">From this statement</p>
                    <p className="font-semibold">{label}</p>
                    <p className="tabular-nums">
                      {money(l.original.amountMinor, currency)} {l.original.direction === "credit" ? "in" : "out"} · {fullDate(l.original.date)}
                    </p>
                    <p className="text-xs text-muted-foreground">{accountName(l.accountId)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">Already recorded</p>
                    <p className="font-semibold">{e.note || "No description"}</p>
                    <p className="tabular-nums">
                      {money(e.amountMinor, currency)} · {fullDate(e.date)}
                    </p>
                    <p className="text-xs text-muted-foreground">{e.categoryName ?? (e.type === "transfer" ? "Transfer" : "")}</p>
                  </div>
                  <div role="radiogroup" aria-label={`${label}, ${fullDate(l.original.date)}`} className="flex gap-3 md:col-span-2">
                    {(["add", "skip"] as const).map((a) => (
                      <label key={a} className="flex items-center gap-1.5">
                        <input type="radio" name={`dup-${l.key}`} className="size-4 accent-(--color-ink)" checked={choice[l.key] === a} onChange={() => setChoice((c) => ({ ...c, [l.key]: a }))} />
                        {a === "add" ? "Add it" : "Skip it"}
                      </label>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => all("skip")}>
              Skip all
            </Button>
            <Button type="button" variant="secondary" onClick={() => all("add")}>
              Add all
            </Button>
            <Button
              type="button"
              disabled={!answered}
              onClick={() =>
                onAnswer({
                  add: new Set(lines.filter((l) => choice[l.key] === "add").map((l) => l.key)),
                  skip: new Set(lines.filter((l) => choice[l.key] === "skip").map((l) => l.key)),
                })
              }
            >
              Use my choices
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
