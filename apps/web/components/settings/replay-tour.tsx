"use client"

import { useState } from "react"
import { setWelcomeOnSignInAction } from "@/app/(app)/onboarding/actions"
import { REPLAY_WELCOME_EVENT } from "@/components/onboarding/welcome-carousel"
import { Button } from "@/components/ui/button"
import { FormMessage } from "@/components/ui/field"
import { cn } from "cn"

/** Settings → Replay the tour: opens the welcome on slide 1 here; nothing is saved. */
export function ReplayTour() {
  return (
    <Button type="button" variant="secondary" onClick={() => window.dispatchEvent(new Event(REPLAY_WELCOME_EVENT))}>
      Replay the tour
    </Button>
  )
}

/** Settings → "Show the welcome when I sign in" (on = profiles.welcome_hidden_at is null). */
export function WelcomeOnSignIn({ hiddenAt }: { hiddenAt: string | null }) {
  const [on, setOn] = useState(hiddenAt === null)
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle")

  async function toggle() {
    const want = !on
    setState("busy")
    const result = await setWelcomeOnSignInAction(want).catch(() => null)
    if (!result?.ok) return setState("failed")
    setOn(want)
    setState("idle")
  }

  return (
    <div className="grid gap-2">
      {state === "failed" && <FormMessage tone="error">We couldn’t change this setting. Please try again.</FormMessage>}
      <div className="flex items-center justify-between gap-4">
        <span id="welcome-on-sign-in" className="text-sm text-ink">
          Show the welcome when I sign in
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="welcome-on-sign-in"
          disabled={state === "busy"}
          onClick={() => void toggle()}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 motion-reduce:transition-none",
            on ? "border-brand-deep bg-brand-deep" : "border-line-strong bg-canvas"
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "inline-block size-4 rounded-full shadow-sm transition-transform motion-reduce:transition-none",
              on ? "translate-x-6 bg-brand" : "translate-x-1 bg-surface ring-1 ring-line-strong"
            )}
          />
        </button>
      </div>
    </div>
  )
}
