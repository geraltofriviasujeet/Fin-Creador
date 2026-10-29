"use client"

import { useActionState, useCallback, useState, useTransition } from "react"
import { Plus } from "lucide-react"
import type { ExpenseCategoryItem } from "@fin-creador/api"
import { EXPENSE_ICON_OPTIONS } from "@fin-creador/schemas"
import { saveExpenseCategoryAction, setExpenseCategoryArchivedAction } from "@/app/(app)/settings/actions"
import { FormActions } from "@/components/income/form-actions"
import { submitWithoutReset } from "@/components/income/submit-without-reset"
import { useFormSuccess } from "@/components/income/use-form-success"
import { CategoryIcon } from "@/components/transactions/display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { toast } from "@/components/ui/toast"
import { initialFormState } from "@/lib/form-state"

type Open = { type: "add" } | { type: "rename" | "archive"; category: ExpenseCategoryItem } | null

/**
 * Settings → Categories: the person's expense categories. Add, rename (and change the
 * icon), archive and restore. Defaults can be archived, never deleted; archived
 * categories keep their entries' history and can be restored.
 */
export function ExpenseCategories({ categories }: { categories: ExpenseCategoryItem[] }) {
  const [open, setOpen] = useState<Open>(null)
  const [openId, setOpenId] = useState(0)
  const [showArchived, setShowArchived] = useState(false)
  const close = useCallback(() => setOpen(null), [])
  const show = (next: NonNullable<Open>) => {
    setOpenId((n) => n + 1) // a fresh form each time
    setOpen(next)
  }
  const active = categories.filter((c) => !c.archived)
  const archived = categories.filter((c) => c.archived)

  return (
    <>
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={() => show({ type: "add" })}>
          <Plus aria-hidden="true" />
          Add category
        </Button>
      </div>

      {active.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No active categories. Add one, or restore an archived one.</p>
      ) : (
        <ul aria-label="Active categories" className="mt-4 grid gap-2">
          {active.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
              <CategoryIcon icon={c.icon} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
              {c.isDefault && <Badge tone="neutral">Default</Badge>}
              <Button variant="ghost" size="sm" aria-label={`Rename ${c.name}`} onClick={() => show({ type: "rename", category: c })}>
                Rename
              </Button>
              {!c.system && (
                <Button variant="ghost" size="sm" aria-label={`Archive ${c.name}`} onClick={() => show({ type: "archive", category: c })}>
                  Archive
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div className="mt-4">
          <Button variant="ghost" size="sm" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
          </Button>
          {showArchived && (
            <ul aria-label="Archived categories" className="mt-2 grid gap-2">
              {archived.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2">
                  <CategoryIcon icon={c.icon} />
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{c.name}</span>
                  <RestoreButton category={c} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog open={open !== null} onOpenChange={(o) => !o && close()}>
        {open?.type === "add" && (
          <DialogContent eyebrow="Categories" title="Add category">
            <CategoryForm key={openId} onDone={close} />
          </DialogContent>
        )}
        {open?.type === "rename" && (
          <DialogContent eyebrow="Categories" title={`Rename ${open.category.name}`}>
            <CategoryForm key={openId} category={open.category} onDone={close} />
          </DialogContent>
        )}
        {open?.type === "archive" && (
          <DialogContent eyebrow="Categories" title={`Archive ${open.category.name}?`}>
            <ArchiveForm key={openId} category={open.category} onDone={close} />
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

function CategoryForm({ category, onDone }: { category?: ExpenseCategoryItem; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveExpenseCategoryAction, initialFormState)
  useFormSuccess(state, onDone)
  const v = state.values ?? {}
  const errors = state.fieldErrors ?? {}
  return (
    <form onSubmit={submitWithoutReset(action)} noValidate className="grid gap-5">
      {state.status === "error" && state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <input type="hidden" name="id" value={category?.id ?? ""} />
      <TextField name="name" label="Name" placeholder="e.g. Pets" maxLength={60} defaultValue={v.name ?? category?.name} error={errors.name} autoFocus />
      <SelectField name="icon" label="Icon" defaultValue={v.icon ?? category?.icon ?? "other"} error={errors.icon}>
        {EXPENSE_ICON_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SelectField>
      {category && <p className="text-xs text-muted-foreground">Past entries in this category show the new name.</p>}
      <FormActions submit={category ? "Save" : "Add category"} busy="Saving…" pending={pending} />
    </form>
  )
}

function ArchiveForm({ category, onDone }: { category: ExpenseCategoryItem; onDone: () => void }) {
  const [state, action, pending] = useActionState(setExpenseCategoryArchivedAction, initialFormState)
  useFormSuccess(state, onDone)
  return (
    <form onSubmit={submitWithoutReset(action)} className="grid gap-5">
      <input type="hidden" name="id" value={category.id} />
      <input type="hidden" name="archived" value="true" />
      <ul className="grid list-disc gap-1.5 pl-5 text-sm text-muted-foreground">
        <li>It can&apos;t be chosen for new expenses.</li>
        <li>Expenses already in it keep it, in totals, filters and history.</li>
        <li>You can restore it at any time.</li>
      </ul>
      {state.status === "error" && state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      <FormActions submit="Archive" busy="Archiving…" pending={pending} />
    </form>
  )
}

function RestoreButton({ category }: { category: ExpenseCategoryItem }) {
  const [pending, startRestore] = useTransition()
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={`Restore ${category.name}`}
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        const formData = new FormData()
        formData.set("id", category.id)
        formData.set("archived", "false")
        startRestore(async () => {
          const result = await setExpenseCategoryArchivedAction(initialFormState, formData)
          if (result.status === "success") toast.success(result.message ?? "Category restored.")
          else toast.error(result.message ?? "We couldn't restore that category. Please try again.")
        })
      }}
    >
      {pending ? "Restoring…" : "Restore"}
    </Button>
  )
}
