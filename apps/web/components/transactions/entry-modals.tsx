"use client"

import { useEffect, useState } from "react"
import type { LedgerAccount, LedgerCategory, LedgerItem, WriteResult } from "@fin-creador/api"
import { type IsoDate, minorToInputString } from "@fin-creador/domain"
import {
  loadHistoryAction,
  saveTransactionAction,
  voidTransactionAction,
} from "@/app/(app)/transactions/actions"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { FormMessage } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { TYPE_NOUN, entryTitle } from "./display"
import { HistoryList, VoidForm } from "./entry-dialogs"
import type { Lookup } from "./filters"
import { type Draft, type EntryType, type SaveResult, TransactionForm } from "./transaction-form"

// Add, edit, void and history dialogs on real data, shared by the Transactions and Income
// pages. Saves go through the server actions (shared writers in packages/api); the
// actions refresh both pages on success.

const toSaveResult = (r: WriteResult): SaveResult =>
  r.status === "success" ? { ok: true } : { ok: false, message: r.message, fieldErrors: r.fieldErrors }

function draftInput(draft: Draft, accounts: LedgerAccount[], requestKey: string, transactionId?: string) {
  const currency = accounts.find((a) => a.id === draft.accountId)?.currency ?? "INR"
  return {
    transactionId: transactionId ?? "",
    type: draft.type,
    amount: minorToInputString(draft.amountMinor, currency),
    categoryId: draft.categoryId ?? "",
    accountId: draft.accountId,
    counterAccountId: draft.counterAccountId ?? "",
    paymentMode: draft.paymentMode ?? "",
    occurredOn: draft.occurredOn,
    note: draft.note ?? "",
    idempotencyKey: requestKey,
  }
}

const NETWORK = "We couldn't reach the server. Your details are kept; try again."

async function run(save: () => Promise<WriteResult>): Promise<WriteResult> {
  try {
    return await save()
  } catch {
    return { status: "error", message: NETWORK }
  }
}

type FormProps = { accounts: LedgerAccount[]; categories: LedgerCategory[]; today: IsoDate }

export function AddEntryDialog({
  type,
  lastExpenseAccountId,
  onTypeChange,
  onClose,
  ...data
}: FormProps & { type: EntryType | null; lastExpenseAccountId?: string | null; onTypeChange: (t: EntryType) => void; onClose: () => void }) {
  return (
    <Dialog open={type !== null} onOpenChange={(open) => !open && onClose()}>
      {type && (
        <DialogContent eyebrow="New transaction" title={`Add ${TYPE_NOUN[type]}`}>
          <TransactionForm
            mode={{ kind: "add", type }}
            {...data}
            lastExpenseAccountId={lastExpenseAccountId}
            onTypeChange={onTypeChange}
            onSave={async (draft, key) => {
              const result = await run(() => saveTransactionAction(draftInput(draft, data.accounts, key)))
              if (result.status === "success") {
                onClose()
                toast.success(result.message)
              }
              return toSaveResult(result)
            }}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}

export function EditEntryDialog({ entry, onClose, ...data }: FormProps & { entry: LedgerItem | null; onClose: () => void }) {
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      {entry && (
        <DialogContent eyebrow="Edit transaction" title={`Edit ${TYPE_NOUN[entry.type]}`} description="Saving keeps the current version in History.">
          <TransactionForm
            mode={{ kind: "edit", entry }}
            {...data}
            onSave={async (draft, key) => {
              const result = await run(() => saveTransactionAction(draftInput(draft, data.accounts, key, entry.id)))
              if (result.status === "success") {
                onClose()
                toast.success(result.message, "The earlier version is kept in History.")
              }
              return toSaveResult(result)
            }}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}

export function VoidEntryDialog({ entry, lookup, onClose }: { entry: LedgerItem | null; lookup: Lookup; onClose: () => void }) {
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      {entry && (
        <DialogContent eyebrow="Void transaction" title={`Void this ${TYPE_NOUN[entry.type]}?`}>
          <VoidForm
            entry={entry}
            lookup={lookup}
            onVoid={async (reason, key) => {
              const result = await run(() => voidTransactionAction({ transactionId: entry.id, reason: reason ?? "", idempotencyKey: key }))
              if (result.status === "success") {
                onClose()
                toast.success(result.message, "It stays in your history and no longer counts.")
              }
              return toSaveResult(result)
            }}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}

type HistoryState = { status: "loading" } | { status: "error" } | { status: "ready"; versions: LedgerItem[] }

export function HistoryDialog({ entry, lookup, onClose }: { entry: LedgerItem | null; lookup: Lookup; onClose: () => void }) {
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      {entry && (
        <DialogContent eyebrow="History" title={entryTitle(entry, lookup)} description="Every saved version, newest first. Earlier versions never count toward totals.">
          <HistoryBody key={entry.id} id={entry.id} lookup={lookup} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function HistoryBody({ id, lookup }: { id: string; lookup: Lookup }) {
  const [state, setState] = useState<HistoryState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    loadHistoryAction(id)
      .then((r) => live && setState(r.ok ? { status: "ready", versions: r.versions } : { status: "error" }))
      .catch(() => live && setState({ status: "error" }))
    return () => {
      live = false
    }
  }, [id, attempt])

  if (state.status === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading history" className="grid gap-3">
        {[0, 1].map((i) => (
          <span key={i} className="h-20 rounded-xl bg-canvas" />
        ))}
      </div>
    )
  }
  if (state.status === "error") {
    return (
      <FormMessage tone="error">
        We couldn&apos;t load the history.{" "}
        <button
          type="button"
          className="font-semibold underline underline-offset-4"
          onClick={() => {
            setState({ status: "loading" })
            setAttempt((n) => n + 1)
          }}
        >
          Try again
        </button>
      </FormMessage>
    )
  }
  return <HistoryList versions={state.versions} lookup={lookup} />
}
