"use client"

import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FormMessage } from "@/components/ui/field"
import { ROMA_RETENTION } from "@/lib/ai/wording"
import { deleteAllRomaConversationsAction, deleteRomaConversationAction } from "@/app/(app)/roma/actions"
import { cn } from "cn"

// Roma's past conversations (Sprint 10.3), beside the chat: open one, delete one or all, or
// start a new one. Deleting asks once more in place; nothing is deleted on the first click.

export type ConversationSummary = { id: string; title: string; lastMessageAt: string }

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
      <Button type="button" variant="secondary" onClick={onNew}>
        New conversation
      </Button>
      {conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No past conversations yet.</p>
      ) : (
        <ul className="grid gap-1">
          {conversations.map((c) => (
            <li key={c.id} className={cn("rounded-lg p-2", c.id === currentId && "bg-canvas")}>
              <Link
                href={`/roma?c=${c.id}`}
                aria-current={c.id === currentId ? "page" : undefined}
                className="block text-sm font-semibold break-words text-ink hover:underline"
              >
                {c.title}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{when.format(new Date(c.lastMessageAt))}</span>
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
            </li>
          ))}
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
