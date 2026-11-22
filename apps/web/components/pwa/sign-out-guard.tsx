"use client"

import { useEffect } from "react"
import { SIGN_OUT_PATHS, clearSnapshotThen, signOutOffline } from "@/lib/pwa/offline-sign-out"

/**
 * Every Sign out form on the site (Sprint 12b, app/layout.tsx): online, deletes the offline
 * snapshot and then posts as before; offline, signs this device out (signOutOffline) and shows
 * the signed-out page. Sign out is never disabled offline.
 */
export function SignOutGuard() {
  useEffect(() => {
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement) || event.defaultPrevented) return
      const path = new URL(form.action, window.location.href).pathname
      if (!(SIGN_OUT_PATHS as readonly string[]).includes(path)) return
      event.preventDefault()
      if (navigator.onLine) void clearSnapshotThen(() => form.submit())
      else void signOutOffline()
    }
    document.addEventListener("submit", onSubmit)
    return () => document.removeEventListener("submit", onSubmit)
  }, [])
  return null
}
