"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { SAVED_EVENT } from "@/lib/pwa/events"
import { SNAPSHOT_IDB, parseSnapshot } from "@/lib/pwa/snapshot"
import { idbClear, idbRead, idbWrite } from "@/lib/pwa/snapshot-idb"

// Keeps the offline snapshot (lib/pwa/snapshot.ts) for the signed-in user (Sprint 12b). In the
// app layout only, so it runs only while someone is signed in.
//
// - On load: a snapshot of another user is deleted at once (a different person signed in).
// - While online: refreshed from /api/offline-snapshot after each page load and each confirmed
//   save (SAVED_EVENT), at most every 15 s except after a save. Stored only if the server's
//   answer is for this same user and has the expected shape.
// - Sign-out (the Sign out forms post to /auth/sign-out): deleted before the form is sent.
//   The idle sign-out deletes it itself (components/shell/idle-guard.tsx), and the sign-in
//   pages delete any left over (components/pwa/snapshot-wipe.tsx).

const SNAPSHOT_URL = "/api/offline-snapshot"
const MIN_GAP_MS = 15_000
const SIGN_OUT_PATHS = ["/auth/sign-out", "/auth/idle-sign-out"]

/** Deletes the snapshot, then sends the sign-out form. */
export async function clearSnapshotThen(send: () => void) {
  try {
    await idbClear(SNAPSHOT_IDB)
  } finally {
    send()
  }
}

export function SnapshotKeeper({ userId }: { userId: string }) {
  const pathname = usePathname()
  const last = useRef(0)
  const inFlight = useRef(false)
  /** A save came in while a refresh was running: refresh again once it ends. */
  const again = useRef(false)
  const refresh = useRef<(force: boolean) => void>(() => {})

  useEffect(() => {
    let alive = true
    // Another user's snapshot never stays on this device; writes wait until it's gone.
    const ready = idbRead(SNAPSHOT_IDB).then(async (stored) => {
      const owner = stored && typeof stored === "object" ? (stored as { userId?: unknown }).userId : undefined
      if (stored && owner !== userId) await idbClear(SNAPSHOT_IDB)
    })

    refresh.current = (force: boolean) => {
      if (!navigator.onLine) return
      if (inFlight.current) {
        if (force) again.current = true
        return
      }
      if (!force && Date.now() - last.current < MIN_GAP_MS) return
      inFlight.current = true
      last.current = Date.now()
      fetch(SNAPSHOT_URL, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } })
        .then(async (res) => {
          if (!res.ok) return
          const snapshot = parseSnapshot(await res.json())
          await ready
          if (alive && snapshot && snapshot.userId === userId) await idbWrite(SNAPSHOT_IDB, snapshot)
        })
        .catch(() => {})
        .finally(() => {
          inFlight.current = false
          if (alive && again.current) {
            again.current = false
            refresh.current(true)
          }
        })
    }

    const onSaved = () => refresh.current(true)
    const onOnline = () => refresh.current(false)
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement)) return
      const path = new URL(form.action, window.location.href).pathname
      if (!SIGN_OUT_PATHS.includes(path) || event.defaultPrevented) return
      event.preventDefault()
      void clearSnapshotThen(() => form.submit())
    }
    window.addEventListener(SAVED_EVENT, onSaved)
    window.addEventListener("online", onOnline)
    document.addEventListener("submit", onSubmit)
    return () => {
      alive = false
      window.removeEventListener(SAVED_EVENT, onSaved)
      window.removeEventListener("online", onOnline)
      document.removeEventListener("submit", onSubmit)
    }
  }, [userId])

  // Each page the person opens (the first load included).
  useEffect(() => {
    refresh.current(false)
  }, [pathname])

  return null
}
