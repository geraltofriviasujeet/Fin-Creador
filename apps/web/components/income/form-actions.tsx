import { DialogClose } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

/** Cancel + primary submit row used by every Income dialog. */
export function FormActions({ submit, busy, pending }: { submit: string; busy: string; pending: boolean }) {
  return (
    <div className="mt-2 flex justify-end gap-3">
      <DialogClose render={<Button type="button" variant="secondary" size="lg" />}>Cancel</DialogClose>
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? busy : submit}
      </Button>
    </div>
  )
}
