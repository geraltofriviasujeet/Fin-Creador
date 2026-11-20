"use client"

import { useTransition } from "react"
import { replayTourAction } from "@/app/(app)/onboarding/actions"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

/** Settings → Replay the tour: clears "tour done", and the tour opens on this page. */
export function ReplayTour() {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      type="button"
      variant="secondary"
      className="mt-5"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await replayTourAction().catch(() => null)
          if (!result?.ok) toast.error("We couldn't start the tour. Check your connection and try again.")
        })
      }
    >
      Replay the tour
    </Button>
  )
}
