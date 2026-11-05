"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertDialog } from "@base-ui/react/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  ACTIVITY_WRITE_EVERY_MS,
  IDLE_SIGN_OUT_PATH,
  LAST_ACTIVE_KEY,
  type IdlePhase,
  countdownText,
  idlePhase,
  lastActiveAt,
} from "@/lib/auth/idle"

// Signs out after 2 hours without activity in any tab of this browser (Sprint 10a), with a
// warning one minute before. Activity (pointer, key, wheel, scroll, touch) is written to
// localStorage, so every open tab shares one clock: activity or "Stay signed in" in one tab
// keeps them all signed in, and they all sign out together. A tab coming back after sleep
// checks at once. Signing out posts to /auth/idle-sign-out, which ends the session with
// Supabase Auth (not just a redirect).

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const

// localStorage can be missing or throw (private windows, blocked storage): fall back to
// this tab's own memory.
let memory: string | null = null
function readStored(): string | null {
  try {
    return window.localStorage.getItem(LAST_ACTIVE_KEY)
  } catch {
    return memory
  }
}
function writeStored(value: string) {
  memory = value
  try {
    window.localStorage.setItem(LAST_ACTIVE_KEY, value)
  } catch {
    // This tab still keeps its own time.
  }
}

/** `signedInAt`: the session's sign-in time, so a fresh sign-in is never treated as idle. */
export function IdleGuard({ signedInAt }: { signedInAt: string | null }) {
  const [phase, setPhase] = useState<IdlePhase>({ phase: "active" })
  const lastWrite = useRef(0)
  const signingOut = useRef(false)
  const warning = phase.phase === "warning"
  const warningRef = useRef(false)
  useEffect(() => {
    warningRef.current = warning
  }, [warning])

  const signOut = useCallback(() => {
    if (signingOut.current) return
    signingOut.current = true
    // A real form post: the browser follows the redirect to the sign-in page.
    const form = document.createElement("form")
    form.method = "post"
    form.action = IDLE_SIGN_OUT_PATH
    const next = document.createElement("input")
    next.type = "hidden"
    next.name = "next"
    next.value = `${window.location.pathname}${window.location.search}`
    form.append(next)
    document.body.append(form)
    form.submit()
  }, [])

  const evaluate = useCallback(() => idlePhase(lastActiveAt(readStored(), signedInAt), Date.now()), [signedInAt])

  const check = useCallback(() => {
    const next = evaluate()
    setPhase((prev) => (prev.phase === next.phase && next.phase !== "warning" ? prev : next))
    if (next.phase === "expired") signOut()
  }, [evaluate, signOut])

  const record = useCallback(() => {
    lastWrite.current = Date.now()
    writeStored(String(lastWrite.current))
  }, [])

  const markActive = useCallback(
    (force = false) => {
      if (!force && Date.now() - lastWrite.current < ACTIVITY_WRITE_EVERY_MS) return
      record()
      check()
    },
    [check, record]
  )

  useEffect(() => {
    // Check before counting anything as activity: a laptop opened after 3 hours signs out.
    // Otherwise opening a page is activity (the phase is already "active").
    if (evaluate().phase === "expired") signOut()
    else record()

    // While the warning shows, only "Stay signed in" (or closing the warning) keeps the session.
    const onActivity = () => {
      if (!warningRef.current) markActive()
    }
    const onVisible = () => document.visibilityState === "visible" && check()
    const onStorage = (e: StorageEvent) => e.key === LAST_ACTIVE_KEY && check()
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true, capture: true })
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", check)
    window.addEventListener("storage", onStorage)
    const timer = window.setInterval(check, 1000)
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, { capture: true })
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", check)
      window.removeEventListener("storage", onStorage)
      window.clearInterval(timer)
    }
  }, [check, evaluate, markActive, record, signOut])

  return (
    <AlertDialog.Root open={warning} onOpenChange={(open) => !open && markActive(true)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-[60] bg-ink/40" />
        <AlertDialog.Viewport className="fixed inset-0 z-[70] grid items-end justify-items-center p-0 md:items-center md:p-4">
          <AlertDialog.Popup
            className="w-full max-w-md rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink shadow-(--shadow-raised) outline-none md:rounded-3xl md:p-6"
          >
            <AlertDialog.Title className="font-heading text-xl font-semibold">Still there?</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              For your security, you&apos;ll be signed out in{" "}
              <span className="font-semibold text-ink tabular-nums">{warning ? countdownText(phase.msLeft) : "1:00"}</span> after 2 hours
              without activity.
            </AlertDialog.Description>
            <div className="mt-5 flex flex-col-reverse gap-3 md:flex-row md:justify-end">
              <Button type="button" variant="secondary" size="lg" onClick={signOut}>
                Sign out now
              </Button>
              <Button type="button" size="lg" autoFocus onClick={() => markActive(true)}>
                Stay signed in
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
