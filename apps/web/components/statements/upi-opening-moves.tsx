"use client"

import { useEffect, useState } from "react"
import {
  type UpiImportOptions,
  type UpiOpeningMove,
  type UpiOpeningPreview,
  type UpiReviewContext,
  type UpiReviewLine,
  upiNewOpeningMinor,
  upiOpeningMoves,
} from "@fin-creador/api"
import { moveUpiOpeningAction, upiOpeningPreviewAction } from "@/app/(app)/transactions/import/upi/actions"
import { fullDate, money } from "@/components/transactions/display"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, SHEET_ACTIONS } from "@/components/ui/dialog"
import { FormMessage } from "@/components/ui/field"

// Payments before an account's opening date (Sprint 9e): per account, the offer to add them and
// move its opening date back to the earliest. Before the person agrees, the old and new opening
// date and amount (the database's figures for what is already saved, plus these payments) and
// what the earlier balances mean. Transfers that can't be added this way are counted and named.

const lineCount = (n: number) => (n === 1 ? "1 payment" : `${n} payments`)

export function UpiOpeningMoves({
  lines,
  options,
  context,
  accountName,
  onMoved,
}: {
  lines: readonly UpiReviewLine[]
  options: UpiImportOptions
  context: UpiReviewContext
  accountName: (id: string) => string
  onMoved: (accountId: string, keys: string[], newDate: string) => void
}) {
  const moves = upiOpeningMoves(lines, options, context)
  const [open, setOpen] = useState<UpiOpeningMove | null>(null)
  if (moves.length === 0) return null
  return (
    <div className="grid gap-2">
      {moves.map((move) => (
        <div key={move.accountId} className="grid gap-2 rounded-xl border border-line px-3 py-2.5 text-sm">
          <p>
            <span className="font-semibold">{move.accountName}</span> opens on {fullDate(move.oldDate)}.{" "}
            {move.keys.length > 0 ? `${lineCount(move.keys.length)} in this statement ${move.keys.length === 1 ? "is" : "are"} earlier.` : "Payments in this statement are earlier."}
          </p>
          {move.incomplete > 0 && (
            <p className="text-muted-foreground">
              {lineCount(move.incomplete)} received {move.incomplete === 1 ? "waits" : "wait"} for a choice (income or a refund): left out of the move; choose for {move.incomplete === 1 ? "it" : "them"} after it.
            </p>
          )}
          {move.blocked.length > 0 && (
            <div className="text-muted-foreground">
              <p>
                Left out: {move.blocked.length === 1 ? "1 transfer" : `${move.blocked.length} transfers`} whose other account also opens after the transfer:
              </p>
              <ul className="list-disc pl-5">
                {move.blocked.map((l) => (
                  <li key={l.key}>
                    {fullDate(l.date)} · {money(l.original.amountMinor, context.currency)} · {accountName(l.accountId)} to {accountName(l.counterAccountId)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {move.newDate && move.keys.length > 0 && (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setOpen(move)}>
                Move opening date to {fullDate(move.newDate)} and import {lineCount(move.keys.length)}
              </Button>
            </div>
          )}
        </div>
      ))}
      {open && (
        <MoveDialog
          key={open.accountId}
          move={open}
          lines={lines.filter((l) => open.keys.includes(l.key))}
          currency={context.currency}
          onClose={() => setOpen(null)}
          onMoved={(keys, newDate) => {
            setOpen(null)
            onMoved(open.accountId, keys, newDate)
          }}
        />
      )}
    </div>
  )
}

function MoveDialog({
  move,
  lines,
  currency,
  onClose,
  onMoved,
}: {
  move: UpiOpeningMove
  lines: UpiReviewLine[]
  currency: string
  onClose: () => void
  onMoved: (keys: string[], newDate: string) => void
}) {
  const newDate = move.newDate!
  const [preview, setPreview] = useState<UpiOpeningPreview | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void upiOpeningPreviewAction({ accountId: move.accountId, newDate }).then((p) => live && setPreview(p))
    return () => {
      live = false
    }
  }, [move.accountId, newDate])

  const save = async () => {
    setSaving(true)
    setMessage(null)
    const result = await moveUpiOpeningAction({
      accountId: move.accountId,
      lines: lines.map((l) => ({
        original: { ref: l.original.ref, direction: l.original.direction, date: l.original.date, amountMinor: l.original.amountMinor, payee: l.original.payee },
        type: l.type,
        date: l.date,
        amount: l.amount,
        accountId: l.accountId,
        counterAccountId: l.type === "transfer" ? l.counterAccountId : "",
        categoryId: l.type === "transfer" ? "" : l.categoryId,
      })),
    })
    setSaving(false)
    if (result.ok) onMoved(result.keys, result.move.newDate)
    else setMessage(result.message)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent eyebrow={move.accountName} title="Move the opening date?">
        <div className="grid gap-3 text-sm">
          {preview === null ? (
            <p aria-busy="true">Checking the account…</p>
          ) : !preview.ok ? (
            <FormMessage tone="error">{preview.message}</FormMessage>
          ) : (
            <>
              <dl className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 tabular-nums">
                <span />
                <dt className="font-semibold">Now</dt>
                <dt className="font-semibold">After</dt>
                <dt>Opening date</dt>
                <dd>{fullDate(preview.oldDate)}</dd>
                <dd>{fullDate(newDate)}</dd>
                <dt>Opening amount</dt>
                <dd>{money(preview.oldMinor, currency)}</dd>
                <dd>{money(upiNewOpeningMinor(preview.oldMinor, move.netMinor, preview.earlierNetMinor), currency)}</dd>
              </dl>
              <p>
                {lineCount(move.keys.length)} {move.keys.length === 1 ? "is" : "are"} added. The balance today, and on every day from {fullDate(preview.oldDate)}, stays the same.
              </p>
              <p>
                Only the payments in this statement are added. Other money in or out of this account before {fullDate(preview.oldDate)} is not, so its balance on those earlier days is approximate.
              </p>
            </>
          )}
          {message && <FormMessage tone="error">{message}</FormMessage>}
          <div className={`flex flex-wrap justify-end gap-2 ${SHEET_ACTIONS}`}>
            <DialogClose render={<Button type="button" variant="secondary" />}>Cancel</DialogClose>
            <Button type="button" disabled={!preview?.ok || saving} aria-busy={saving} onClick={() => void save()}>
              {saving ? "Saving…" : `Move and import ${lineCount(move.keys.length)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
