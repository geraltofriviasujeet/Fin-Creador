"use client"

import { useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { controlClasses } from "@/components/ui/input"
import type { ChatResponseBody } from "@/lib/ai/handle"
import { MAX_QUESTION_CHARS } from "@/lib/ai/limits"
import { ROMA_DATA_NOTICE, ROMA_INFORMATIONAL } from "@/lib/ai/wording"
import { allowRomaDescriptionsAction } from "@/app/(app)/roma/actions"
import { type ConversationSummary, RomaHistory } from "./roma-history"
import { cn } from "cn"

// Roma's page (Sprint 10.1): a static greeting, then one question at a time. An answer is
// shown only after the server has checked every number in it. From 10.2, when a search left
// descriptions out, the answer carries the data notice and one button to agree
// (roma_descriptions_ok_at). From 10.3 questions belong to a conversation: the server sends
// the recent turns with each question and records the answer; past conversations are listed
// beside the chat. A stored turn shows its answer text only: figures are not stored, so the
// figures panel is for answers given in this visit.

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
  conversations: ConversationSummary[]
  /** A past conversation opened from the list (?c=), newest turn first. */
  open: OpenConversation | null
  /** The conversation asked for no longer exists. */
  missing?: boolean
}

export function RomaChat({ greeting, timeZone, conversations: initialConversations, open, missing = false }: Props) {
  const [question, setQuestion] = useState("")
  const [turns, setTurns] = useState<Turn[]>(open?.turns ?? [])
  const [conversationId, setConversationId] = useState<string | null>(open?.id ?? null)
  const [conversations, setConversations] = useState(initialConversations)
  const [notice, setNotice] = useState<string | null>(missing ? "That conversation was deleted. You’re in a new one." : null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [consent, setConsent] = useState<Consent>("ask")
  // Opening a conversation from the list is a navigation: the server sends new props, and the
  // chat shows that conversation even if it is the one already in the address.
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

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = question.trim()
    if (!text || pending) return
    setPending(true)
    setFailure(null)
    setNotice(null)
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, conversationId }),
      })
      const reply = (await response.json()) as ChatResponseBody
      setTurns((t) => [{ id: crypto.randomUUID(), question: text, reply }, ...t])
      if (reply.status === "answer") {
        setQuestion("")
        if (reply.saved && reply.conversationId) recorded(reply.conversationId, text)
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
  function recorded(id: string, text: string) {
    const now = new Date().toISOString()
    setConversations((list) => {
      const existing = list.find((c) => c.id === id)
      const title = existing?.title ?? text.replace(/\s+/g, " ").slice(0, 80)
      return [{ id, title, lastMessageAt: now }, ...list.filter((c) => c.id !== id)]
    })
    if (id !== conversationId) {
      setConversationId(id)
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,42rem)_16rem] lg:items-start">
      <div className="grid min-w-0 gap-4">
        <details className="rounded-lg border border-line bg-surface p-3 lg:hidden">
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
            <label htmlFor={inputId} className="text-sm font-semibold text-ink">
              Your question
            </label>
            <textarea
              id={inputId}
              name="question"
              rows={3}
              maxLength={MAX_QUESTION_CHARS}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={sendOnEnter}
              placeholder={EXAMPLE}
              className={cn(controlClasses, "h-auto py-2")}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{ROMA_INFORMATIONAL}</p>
              <Button type="submit" disabled={pending || question.trim() === ""}>
                {pending ? "Asking…" : "Ask Roma"}
              </Button>
            </div>
          </form>
          <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">
            {pending ? "Roma is checking your records…" : ""}
          </p>
          {failure && (
            <FormMessage tone="error" className="mt-2">
              {failure}
            </FormMessage>
          )}
        </Card>

        {turns.length === 0 ? (
          <p className="text-sm text-muted-foreground">Try “{EXAMPLE}”. Roma answers from your own records and says when she can’t see something.</p>
        ) : (
          <ol className="grid gap-4" aria-label="Roma's answers">
            {turns.map((turn) => (
              <li key={turn.id}>
                <Card>
                  <p className="text-sm font-semibold text-ink">{turn.question}</p>
                  <Reply reply={turn.reply} />
                  {turn.asOf && (
                    <p className="mt-2 text-xs text-muted-foreground">Answered on {turn.asOf}. Ask again for today’s figures.</p>
                  )}
                  {turn.reply.status === "answer" && !turn.reply.saved && !turn.asOf && (
                    <p className="mt-2 text-xs text-muted-foreground">This answer couldn’t be saved to your conversations.</p>
                  )}
                  {turn.reply.status === "answer" && turn.reply.descriptionsNotice && turn.id === latestNotice && (
                    <DescriptionsNotice consent={consent} setConsent={setConsent} />
                  )}
                </Card>
              </li>
            ))}
          </ol>
        )}
      </div>
      <aside className="hidden lg:sticky lg:top-4 lg:block">{history}</aside>
    </div>
  )
}

function Reply({ reply }: { reply: ChatResponseBody }) {
  if (reply.status === "error") {
    return (
      <FormMessage tone={reply.code === "unverified" || reply.code === "tone" ? "info" : "error"} className="mt-3">
        {reply.message}
      </FormMessage>
    )
  }
  return (
    <div className="mt-3 grid gap-3">
      <p className="text-sm whitespace-pre-line text-ink">{reply.answer}</p>
      {reply.figures.length > 0 && (
        <div className="rounded-lg bg-canvas p-3">
          <p className="text-xs font-semibold text-muted-foreground">
            From your records
            {reply.periods.map((p) => ` · ${p.from} to ${p.to}`).join("")}
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {reply.figures.map((f, i) => (
              <div key={i} className="contents">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className="text-right font-semibold text-ink tabular-nums">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}

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
      <FormMessage tone="success" className="mt-3">
        Descriptions allowed. Ask again to include them. You can stop this by turning Roma off in Settings.
      </FormMessage>
    )
  }
  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-line p-3">
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
