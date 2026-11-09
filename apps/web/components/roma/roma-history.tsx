"use client"

import Link from "next/link"
import { useState } from "react"
import { MessageCircle, Send, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormMessage } from "@/components/ui/field"
import { ROMA_RETENTION } from "@/lib/ai/wording"
import { deleteAllRomaConversationsAction, deleteRomaConversationAction } from "@/app/(app)/roma/actions"
import { cn } from "cn"

// Roma's past conversations (Sprint 10.3), beside the chat: open one, delete one or all, or
// start a new one. Deleting asks once more in place; nothing is deleted on the first click.
// Each is a card with its date and a type marker (2026-11-09): a conversation holding a
// plan shows as a travel or purchase plan, any other as a question.

/** "trip" or "purchase": the conversation holds a plan of that kind; "question": it doesn't. */
export type ConversationKind = "question" | "trip" | "purchase"
export type ConversationSummary = { id: string; title: string; lastMessageAt: string; kind: ConversationKind }

const KINDS: Record<ConversationKind, { label: string; Icon: typeof Send }> = {
  question: { label: "Question", Icon: MessageCircle },
  trip: { label: "Travel plan", Icon: Send },
  purchase: { label: "Purchase plan", Icon: Target },
}

type Props = {
  conversations: ConversationSummary[]
  currentId: string | null
  timeZone: string
  onNew: () => void
  onDeleted: (id: string | "all") => void
}

export function RomaHistory({ conversations, currentId, timeZone, onNew, onDeleted }: Props) {
  const [confirming, setConfirming] = useState<string | "all" | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const when = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone })

  async function remove(target: string | "all") {
    setBusy(true)
    setFailed(false)
    try {
      const { ok } = target === "all" ? await deleteAllRomaConversationsAction() : await deleteRomaConversationAction(target)
      if (ok) {
        onDeleted(target)
        setConfirming(null)
      } else {
        setFailed(true)
      }
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <nav aria-label="Past conversations" className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-ink">Conversations</h2>
          <p className="text-xs text-muted-foreground">Recent questions and plans</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onNew}>
          New conversation
        </Button>
      </div>
      {conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No past conversations yet.</p>
      ) : (
        <ul className="grid gap-2">
          {conversations.map((c) => {
            const { label, Icon } = KINDS[c.kind]
            const current = c.id === currentId
            return (
              <li
                key={c.id}
                data-kind={c.kind}
                className={cn("relative flex gap-3 rounded-xl border p-3 transition-colors hover:bg-canvas motion-reduce:transition-none", current ? "border-transparent bg-chip-mint" : "border-line bg-surface")}
              >
                <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-lg text-ink", c.kind === "question" ? "bg-canvas" : "bg-brand")}>
                  <Icon className="size-4" />
                </span>
                <div className="grid min-w-0 flex-1 gap-1">
                  {/* The whole card opens the conversation; the link's name stays the title. */}
                  <Link
                    href={`/roma?c=${c.id}`}
                    aria-current={current ? "page" : undefined}
                    className="text-sm font-semibold break-words text-ink after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
                  >
                    {c.title}
                  </Link>
                  <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {label} · {when.format(new Date(c.lastMessageAt))}
                    </span>
                    {confirming === c.id ? (
                      <>
                        <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => remove(c.id)}>
                          {busy ? "Deleting…" : "Delete"}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="underline hover:text-ink"
                        aria-label={`Delete conversation: ${c.title}`}
                        onClick={() => setConfirming(c.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {conversations.length > 0 &&
        (confirming === "all" ? (
          <div className="grid gap-2 rounded-lg border border-line p-3">
            <p className="text-sm text-ink">Delete all {conversations.length === 1 ? "your conversation" : `${conversations.length} conversations`}? This can’t be undone.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => remove("all")}>
                {busy ? "Deleting…" : "Delete all"}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setConfirming("all")}>
            Delete all conversations
          </Button>
        ))}
      {failed && <FormMessage tone="error">We couldn’t delete this. Try again.</FormMessage>}
      <p className="text-xs text-muted-foreground">{ROMA_RETENTION}</p>
    </nav>
  )
}
