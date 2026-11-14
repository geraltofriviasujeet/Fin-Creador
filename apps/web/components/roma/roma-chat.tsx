"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { controlClasses } from "@/components/ui/input"
import type { ChatResponseBody } from "@/lib/ai/handle"
import { webPrice, webTotal } from "@/lib/ai/web-format"
import { MAX_QUESTION_CHARS } from "@/lib/ai/limits"
import { ROMA_DATA_NOTICE, ROMA_INFORMATIONAL, basisLabels } from "@/lib/ai/wording"
import { allowRomaDescriptionsAction } from "@/app/(app)/roma/actions"
import { detectPlan } from "@/lib/ai/plan/intake"
import type { PlanRequest } from "@/lib/ai/plan/types"
import { PlanIntake } from "./plan-intake"
import { PlanModal, PlanSummary } from "./plan-modal"
import { type ConversationKind, type ConversationSummary, RomaHistory } from "./roma-history"
import { cn } from "cn"

// Roma's page (Sprint 10.1): a static greeting, then one question at a time. An answer is
// shown only after the server has checked every number in it. From 10.2, when a search left
// descriptions out, the answer carries the data notice and one button to agree
// (roma_descriptions_ok_at). From 10.3 questions belong to a conversation: the server sends
// the recent turns with each question and records the answer; past conversations are listed
// beside the chat. A stored turn shows its answer text only: figures are not stored, so the
// figures panel is for answers given in this visit. From 10.4 a goal check shows its verdict
// (computed in code) above the answer and its assumptions under the figures. From 10.8 web
// prices sit in their own block after the records' figures, each with its site and link, and a
// web-assisted verdict is a second, marked line under the records' verdict, never in its place.
// From 10.9 a question asking for a plan ("plan my trip to Goa", "can I buy a car") first shows
// the plan intake (questions written in code, each skippable) instead of being sent; the plan
// that comes back opens in a modal, from the checked plan only (also from a past conversation).
// Layout from docs/design/roma (2026-11-09): each turn is a card, the question in a dark bubble
// and Roma's reply beside her mark; a plan's reply is a summary card (the detail is in the
// modal); an answer's figures are a table, with the period and sources under it.

export type Turn = {
  id: string
  question: string
  reply: ChatResponseBody
  /** Set for a stored turn: the person's today it was answered against. */
  asOf?: string
}

export type OpenConversation = { id: string; turns: Turn[] }

const EXAMPLE = "What did I spend last month?"
const OPENING = "I’m Roma, your Intelligent Finance Analyst. What do you want to know?"

type Props = {
  greeting: string
  timeZone: string
  /** The profile currency, for a plan's trade-in or deposit. */
  currency: string
  conversations: ConversationSummary[]
  /** A past conversation opened from the list (?c=), newest turn first. */
  open: OpenConversation | null
  /** The conversation asked for no longer exists. */
  missing?: boolean
}

// Opening a conversation from the list is a navigation, and the chat starts afresh for it (like
// the statement import keyed by card). The key follows the conversation in the address rather
// than the server's props: the chat moves the address itself (a new conversation, the first
// answer recorded) without a server render, so Next can open a conversation it already holds
// without sending new props, so it is asked for them again. Those moves are the chat's own and
// keep its state.
export function RomaChat(props: Props) {
  const router = useRouter()
  const inAddress = useSearchParams().get("c")
  const [seen, setSeen] = useState(inAddress)
  const [moved, setMoved] = useState<string | null | undefined>(undefined)
  const [generation, setGeneration] = useState(0)
  if (inAddress !== seen) {
    setSeen(inAddress)
    setMoved(undefined)
    if (inAddress !== moved) setGeneration((g) => g + 1)
  }
  useEffect(() => {
    if (generation > 0) router.refresh()
  }, [generation, router])
  return <Conversation key={generation} {...props} onMove={setMoved} />
}

function Conversation({
  greeting,
  timeZone,
  currency,
  conversations: initialConversations,
  open,
  missing = false,
  onMove,
}: Props & { onMove: (id: string | null) => void }) {
  // A question handed over in the address (?ask=, from the Goals page) is only filled in, never
  // sent: asking spends one of the person's questions, so they press Send themselves.
  const asked = useSearchParams().get("ask")
  const [question, setQuestion] = useState(() => (open ? "" : (asked ?? "").trim().slice(0, MAX_QUESTION_CHARS)))
  const [turns, setTurns] = useState<Turn[]>(open?.turns ?? [])
  const [conversationId, setConversationId] = useState<string | null>(open?.id ?? null)
  const [conversations, setConversations] = useState(initialConversations)
  const [notice, setNotice] = useState<string | null>(missing ? "That conversation was deleted. You’re in a new one." : null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [consent, setConsent] = useState<Consent>("ask")
  const [intake, setIntake] = useState<{ question: string; draft: PlanRequest } | null>(null)
  // The props the server sent after the address moved (see RomaChat) replace what was shown.
  const [shown, setShown] = useState({ open, initialConversations })
  if (shown.open !== open || shown.initialConversations !== initialConversations) {
    setShown({ open, initialConversations })
    setTurns(open?.turns ?? [])
    setConversationId(open?.id ?? null)
    setConversations(initialConversations)
    setFailure(null)
    setNotice(missing ? "That conversation was deleted. You’re in a new one." : null)
  }
  const inputId = useId()
  const formRef = useRef<HTMLFormElement>(null)

  function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = question.trim()
    if (!text || pending) return
    // A plan asks its own questions first (10.9); nothing is sent until the intake is done.
    const draft = detectPlan(text, todayIn(timeZone))
    if (draft) {
      setIntake({ question: text, draft })
      return
    }
    void send(text)
  }

  async function send(text: string, plan?: PlanRequest) {
    if (pending) return
    setPending(true)
    setFailure(null)
    setNotice(null)
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, conversationId, ...(plan ? { plan } : {}) }),
      })
      const reply = (await response.json()) as ChatResponseBody
      setTurns((t) => [{ id: crypto.randomUUID(), question: text, reply }, ...t])
      if (reply.status === "answer") {
        setQuestion("")
        setIntake(null)
        if (reply.saved && reply.conversationId) recorded(reply.conversationId, text, reply.plan?.kind ?? "question")
      } else if (reply.code === "conversation_missing" && conversationId) {
        forget(conversationId)
        setConversationId(null)
      }
    } catch {
      // Keep the question so it can be sent again.
      setFailure("We couldn’t reach Roma. Check your connection and try again.")
    } finally {
      setPending(false)
    }
  }

  // The answer was stored: list the conversation first, and keep its address for a reload.
  function recorded(id: string, text: string, kind: ConversationKind) {
    const now = new Date().toISOString()
    setConversations((list) => {
      const existing = list.find((c) => c.id === id)
      const title = existing?.title ?? text.replace(/\s+/g, " ").slice(0, 80)
      // A plan marks the conversation; a later question doesn't unmark it.
      const marked = existing && existing.kind !== "question" ? existing.kind : kind
      return [{ id, title, lastMessageAt: now, kind: marked }, ...list.filter((c) => c.id !== id)]
    })
    if (id !== conversationId) {
      setConversationId(id)
      onMove(id)
      window.history.replaceState(null, "", `/roma?c=${id}`)
    }
  }

  function forget(id: string) {
    setConversations((list) => list.filter((c) => c.id !== id))
  }

  function startNew() {
    setTurns([])
    setConversationId(null)
    setFailure(null)
    setNotice(null)
    onMove(null)
    window.history.replaceState(null, "", "/roma")
  }

  function deleted(target: string | "all") {
    if (target === "all") setConversations([])
    else forget(target)
    if (target === "all" || target === conversationId) startNew()
  }

  // The notice shows under the newest answer that left descriptions out.
  const latestNotice = turns.find((t) => t.reply.status === "answer" && t.reply.descriptionsNotice)?.id

  // Enter sends; Shift+Enter adds a line. Composing (e.g. an IME) keeps Enter for the composer.
  function sendOnEnter(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    formRef.current?.requestSubmit()
  }

  const history = (
    <RomaHistory conversations={conversations} currentId={conversationId} timeZone={timeZone} onNew={startNew} onDeleted={deleted} />
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start">
      <div className="grid min-w-0 gap-4">
        <details className="rounded-2xl border border-line bg-surface p-4 lg:hidden">
          <summary className="cursor-pointer text-sm font-semibold text-ink">Past conversations ({conversations.length})</summary>
          <div className="mt-3">{history}</div>
        </details>
        {notice && <FormMessage tone="info">{notice}</FormMessage>}
        {turns.length === 0 && (
          <div className="grid gap-1">
            <p className="font-heading text-lg font-semibold text-ink">{greeting}</p>
            <p className="text-xl font-bold text-ink italic">{OPENING}</p>
          </div>
        )}
        <Card>
          <form ref={formRef} onSubmit={ask} className="grid gap-3">
            <div className="flex items-center gap-3">
              <RomaMark />
              <label htmlFor={inputId} className="font-heading text-base font-semibold text-ink">
                Your question
              </label>
            </div>
            <textarea
              id={inputId}
              name="question"
              rows={3}
              maxLength={MAX_QUESTION_CHARS}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={sendOnEnter}
              placeholder={EXAMPLE}
              className={cn(controlClasses, "h-auto rounded-xl py-2")}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{ROMA_INFORMATIONAL}</p>
              <Button type="submit" variant="primary" disabled={pending || question.trim() === ""}>
                {pending ? "Asking…" : "Ask Roma"}
              </Button>
            </div>
          </form>
          <p aria-live="polite" className="mt-3 text-sm text-muted-foreground empty:hidden">
            {pending ? "Roma is checking your records…" : ""}
          </p>
          {failure && (
            <FormMessage tone="error" className="mt-2">
              {failure}
            </FormMessage>
          )}
        </Card>

        {intake && (
          <PlanIntake
            key={intake.question}
            question={intake.question}
            draft={intake.draft}
            today={todayIn(timeZone)}
            currency={currency}
            pending={pending}
            onPlan={(plan) => void send(intake.question, plan)}
            onAsk={() => {
              const text = intake.question
              setIntake(null)
              void send(text)
            }}
            onCancel={() => setIntake(null)}
          />
        )}

        {turns.length === 0 ? (
          <p className="text-sm text-muted-foreground">Try “{EXAMPLE}”. Roma answers from your own records and says when she can’t see something.</p>
        ) : (
          <ol className="grid gap-4" aria-label="Roma's answers">
            {turns.map((turn) => (
              <li key={turn.id}>
                <Card className="grid gap-4">
                  <div className="on-dark grid max-w-[85%] gap-1 justify-self-end rounded-2xl bg-brand-deep px-4 py-3 text-nav-text">
                    <p className="text-xs text-nav-muted">You</p>
                    <p className="text-sm break-words whitespace-pre-line text-white">{turn.question}</p>
                  </div>
                  <div className="flex gap-3">
                    <RomaMark />
                    <div className="grid min-w-0 flex-1 gap-3">
                      <p className="flex flex-wrap items-center gap-x-2 text-sm">
                        <span className="font-semibold text-ink">Roma</span>
                        {turn.reply.status === "answer" &&
                          basisLabels(turn.reply.basis).map((label) => (
                            <span key={label} className="inline-flex items-center gap-1 text-xs text-success">
                              <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
                              {label}
                            </span>
                          ))}
                      </p>
                      <Reply
                        reply={turn.reply}
                        madeOn={turn.asOf ?? todayIn(timeZone)}
                        reopened={turn.asOf !== undefined}
                        currency={currency}
                        today={todayIn(timeZone)}
                        onPickModel={pending ? undefined : (plan, words) => void send(words, plan)}
                      />
                      {turn.asOf && <p className="text-xs text-muted-foreground">Answered on {turn.asOf}. Ask again for today’s figures.</p>}
                      {turn.reply.status === "answer" && !turn.reply.saved && !turn.asOf && (
                        <p className="text-xs text-muted-foreground">This answer couldn’t be saved to your conversations.</p>
                      )}
                      {turn.reply.status === "answer" && turn.reply.descriptionsNotice && turn.id === latestNotice && (
                        <DescriptionsNotice consent={consent} setConsent={setConsent} />
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </div>
      <aside className="hidden lg:sticky lg:top-4 lg:block">
        <Card>{history}</Card>
      </aside>
    </div>
  )
}

/** Roma's mark: the sparkle on lime, beside her replies and the question box. */
function RomaMark() {
  return (
    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand text-ink">
      <Sparkles className="size-4" />
    </span>
  )
}

function Reply({
  reply,
  madeOn,
  reopened,
  currency,
  today,
  onPickModel,
}: {
  reply: ChatResponseBody
  madeOn: string
  reopened: boolean
  currency: string
  today: string
  /** A shortlist's "Pick this model": makes that model's plan (a new question); absent while one is being answered. */
  onPickModel?: (plan: PlanRequest, words: string) => void
}) {
  const [planOpen, setPlanOpen] = useState(false)
  if (reply.status === "error") {
    return (
      <FormMessage tone={reply.code === "unverified" || reply.code === "tone" ? "info" : "error"}>
        {reply.message}
      </FormMessage>
    )
  }
  // A plan: the summary card only; every line, verdict and source is in the modal.
  if (reply.plan) {
    return (
      <>
        <PlanSummary plan={reply.plan} onOpen={() => setPlanOpen(true)} />
        <PlanModal
          plan={reply.plan}
          madeOn={madeOn}
          reopened={reopened}
          open={planOpen}
          onOpenChange={setPlanOpen}
          {...(reply.planLink ? { link: reply.planLink } : {})}
          currency={currency}
          today={today}
          {...(onPickModel ? { onPickModel } : {})}
        />
      </>
    )
  }
  const period = reply.periods.map((p) => `${p.from} to ${p.to}`).join(", ")
  return (
    <div className="grid gap-3">
      {reply.checks?.map((c, i) => (
        <div key={i} className="rounded-xl border border-line border-l-4 border-l-brand-deep bg-surface px-3 py-2">
          <p className="text-xs font-semibold text-muted-foreground">
            {c.kind === "trip" ? "Trip check" : "Goal check"} · {c.goal}
            {c.web ? " · From your records" : ""}
          </p>
          <p className="font-heading text-lg font-bold text-ink">{c.verdict}</p>
          {c.web && (
            <div className="mt-2 border-t border-dashed border-line pt-2" data-testid="web-verdict">
              <p className="text-xs font-semibold text-muted-foreground">
                {c.web.webOnly ? "Web estimates only, no basis in your records" : "With web estimates, not your records"}
              </p>
              <p className="text-sm text-ink">{c.web.summary}</p>
            </div>
          )}
        </div>
      ))}
      <p className="text-sm whitespace-pre-line text-ink">{reply.answer}</p>
      {reply.figures.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">Figures from your records</caption>
            <thead className="bg-canvas text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Figure
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reply.figures.map((f, i) => (
                <tr key={i}>
                  <th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">
                    {f.label}
                  </th>
                  <td className="px-3 py-2 text-right font-semibold text-ink tabular-nums">{f.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(reply.figures.length > 0 || period) && (
        <p className="text-xs text-muted-foreground">
          From your records{period ? ` · ${period}` : ""}
          {reply.web ? " · Web estimates below, each with its source" : ""}
        </p>
      )}
      {reply.citations && <Sources citations={reply.citations} />}
      {reply.web && <WebEstimates web={reply.web} />}
      {reply.webNotices?.map((n) => (
        <FormMessage key={n} tone="info">
          {n}
        </FormMessage>
      ))}
      {reply.checks?.map(
        (c, i) =>
          c.assumptions.length > 0 && (
            <div key={i} className="rounded-xl border border-line p-3">
              <p className="text-xs font-semibold text-muted-foreground">Assumptions{reply.checks!.length > 1 ? ` · ${c.goal}` : ""}</p>
              <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-ink">
                {c.assumptions.map((a, j) => (
                  <li key={j}>{a}</li>
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  )
}

/**
 * The knowledge base passages an answer cites (10.6c), numbered as in the answer. Each opens to
 * the passage itself, so a figure can be checked against what it applies to. Built in code from
 * the retrieved passage; a link only where the publisher allows one.
 */
function Sources({ citations }: { citations: NonNullable<Extract<ChatResponseBody, { status: "answer" }>["citations"]> }) {
  return (
    <section className="rounded-xl border border-line p-3" aria-label="Sources from the knowledge base">
      <p className="text-xs font-semibold text-muted-foreground">From the knowledge base</p>
      <ul className="mt-2 grid gap-2 text-sm">
        {citations.map((c) => (
          <li key={c.n}>
            <details className="group rounded-lg border border-line bg-canvas px-3 py-2" data-testid="citation">
              <summary className="cursor-pointer text-ink">
                <span className="font-semibold">[{c.n}]</span> {c.title}
                <span className="text-muted-foreground">
                  {" "}
                  · {c.source}
                  {c.financialYear ? ` · For FY ${c.financialYear}` : ""}
                </span>
              </summary>
              <div className="mt-2 grid gap-2">
                <p className="text-xs font-semibold text-muted-foreground">The passage Roma used</p>
                <blockquote className="border-l-2 border-line pl-3 text-sm whitespace-pre-line text-ink">{c.passage}</blockquote>
                {c.linkPending && <p className="text-xs text-muted-foreground">Link pending the publisher&rsquo;s permission.</p>}
                {c.url && (
                  <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm text-ink underline underline-offset-2">
                    Read more at the source
                  </a>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {citations
        .filter((c) => c.outOfDate)
        .map((c) => (
          <div key={c.n} className="mt-2">
            <FormMessage tone="info">{`[${c.n}] is for FY ${c.financialYear}, which has ended. It may be out of date.`}</FormMessage>
          </div>
        ))}
    </section>
  )
}

/** Web prices kept for this answer (10.8), apart from the records: each with its site and a link to check it. */
function WebEstimates({ web }: { web: NonNullable<Extract<ChatResponseBody, { status: "answer" }>["web"]> }) {
  return (
    <section className="rounded-xl border border-dashed border-line p-3" aria-label="Web estimates">
      <p className="text-xs font-semibold text-muted-foreground">Web estimates. Check the source.</p>
      <ul className="mt-2 grid gap-2 text-sm">
        {web.figures.map((f, i) => (
          <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4">
            <span className="text-muted-foreground">
              {f.label} ·{" "}
              <a href={f.url} target="_blank" rel="noopener noreferrer nofollow" className="text-ink underline underline-offset-2">
                {f.site}
              </a>
            </span>
            <span className="font-semibold text-ink tabular-nums">{webPrice(f)}</span>
          </li>
        ))}
        {web.totals.map((t) => (
          <li key={t.currency} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-line pt-2">
            <span className="text-muted-foreground">
              Web total, {t.costLines.join(", ")} only
              {web.trip ? ` · ${web.trip.nights} ${web.trip.nights === 1 ? "night" : "nights"}, ${web.trip.travellers} ${web.trip.travellers === 1 ? "traveller" : "travellers"}` : ""}
            </span>
            <span className="font-semibold text-ink tabular-nums">{webTotal(t)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">Prices as the sites show them, in their own currency, not converted. They can change; check the source before you rely on them.</p>
    </section>
  )
}

/** The person's today in their time zone (YYYY-MM-DD), for the intake's months. */
const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())

type Consent = "ask" | "saving" | "allowed" | "failed"

function DescriptionsNotice({ consent, setConsent }: { consent: Consent; setConsent: (c: Consent) => void }) {
  async function allow() {
    setConsent("saving")
    try {
      setConsent((await allowRomaDescriptionsAction()).ok ? "allowed" : "failed")
    } catch {
      setConsent("failed")
    }
  }

  if (consent === "allowed") {
    return (
      <FormMessage tone="success">
        Descriptions allowed. Ask again to include them. You can stop this by turning Roma off in Settings.
      </FormMessage>
    )
  }
  return (
    <div className="grid gap-2 rounded-xl border border-line p-3">
      <p className="text-sm text-ink">Roma left out the descriptions of these entries. {ROMA_DATA_NOTICE}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={allow} disabled={consent === "saving"}>
          {consent === "saving" ? "Saving…" : "Allow descriptions"}
        </Button>
        {consent === "failed" && <FormMessage tone="error">We couldn’t save this. Try again.</FormMessage>}
      </div>
    </div>
  )
}
