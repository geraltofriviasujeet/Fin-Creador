"use client"

import * as React from "react"
import { isIosSafari } from "@/lib/pwa/install"

// Online state and installing the app (Sprint 12b), for the whole site (app/layout.tsx).
//
// Online: navigator.onLine and its online/offline events. The server render and the first
// client render say "online", so nothing is disabled until the browser says otherwise.
// Install: Chrome and Android fire beforeinstallprompt, kept here so Settings and the phone
// card can show the browser's own install dialog later; iPhone Safari has no such event, so
// those places show the "Share → Add to Home Screen" steps instead. Already installed (opened
// from the home screen): nothing is offered.

/** Why Save and Add are disabled while offline (the banner says the same). */
export const OFFLINE_REASON = "You’re offline · Saving is paused"

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

export type InstallState = {
  /** Running as an installed app. */
  installed: boolean
  /** The browser's install dialog is available (Chrome, Android). */
  canPrompt: boolean
  /** iPhone or iPad Safari: install by hand from the Share menu. */
  iosSafari: boolean
  /** Shows the browser's install dialog; true when the person installed. */
  prompt: () => Promise<boolean>
}

type PwaState = { online: boolean; install: InstallState }

const PwaContext = React.createContext<PwaState>({
  online: true,
  install: { installed: false, canPrompt: false, iosSafari: false, prompt: async () => false },
})

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

/** Whether the page runs as an installed app (home-screen icon). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function subscribeStandalone(onChange: () => void) {
  const query = window.matchMedia("(display-mode: standalone)")
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

const noSubscribe = () => () => {}

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const online = React.useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  const [deferred, setDeferred] = React.useState<InstallPromptEvent | null>(null)
  // Browser-only facts: the server render (and hydration) say "not installed, not iOS Safari".
  const standalone = React.useSyncExternalStore(subscribeStandalone, isStandalone, () => false)
  const iosSafari = React.useSyncExternalStore(noSubscribe, () => isIosSafari(navigator.userAgent, navigator.maxTouchPoints), () => false)
  const [justInstalled, setInstalled] = React.useState(false)
  const installed = standalone || justInstalled

  React.useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as InstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  const prompt = React.useCallback(async () => {
    if (!deferred) return false
    setDeferred(null) // each event can show the dialog once
    try {
      await deferred.prompt()
      const choice = await deferred.userChoice
      if (choice.outcome === "accepted") setInstalled(true)
      return choice.outcome === "accepted"
    } catch {
      return false
    }
  }, [deferred])

  const value = React.useMemo<PwaState>(
    () => ({ online, install: { installed, canPrompt: deferred !== null && !installed, iosSafari: iosSafari && !installed, prompt } }),
    [online, installed, deferred, iosSafari, prompt]
  )
  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>
}

export const useOnline = () => React.useContext(PwaContext).online
export const useInstall = () => React.useContext(PwaContext).install
