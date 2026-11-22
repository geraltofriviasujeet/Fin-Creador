"use client"

import { useEffect, useRef, useTransition } from "react"

/**
 * Runs a dialog's save as a transition, so the dialog closes only once the page shows the
 * result (Sprint 12a-1: Goals and Investments closed and toasted ~2 s before the refreshed
 * page arrived, flashing the empty state or an old total).
 *
 * The save action calls revalidatePath; because it runs inside the transition, `pending` stays
 * true until the refreshed server render has been committed. `save` returns what to do next
 * (close and toast, or show the error); that runs only after `pending` turns false, so the
 * dialog never closes over stale figures, and a failed save leaves it open with its error.
 * A second submit while one is in flight is ignored (one save per double click), on top of
 * the disabled button.
 */
export function useSaveTransition() {
  const [pending, startTransition] = useTransition()
  const busy = useRef(false)
  const after = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (pending) return
    busy.current = false
    const next = after.current
    after.current = null
    next?.()
  }, [pending])

  function run(save: () => Promise<() => void>) {
    if (busy.current) return
    busy.current = true
    startTransition(async () => {
      after.current = await save()
    })
  }

  return [pending, run] as const
}
