"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { registersServiceWorker, serviceWorkerUrl } from "@/lib/pwa/config"

// Registers the service worker (public/sw.js) in production builds (Sprint 12b) and offers a
// waiting new version as "Update available · Reload". It never reloads by itself: only the
// Reload button activates the new version (SKIP_WAITING), then the page reloads once.
// With the kill switch on (lib/pwa/config.ts), it unregisters instead.

export function ServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const reloading = useRef(false)

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    const sw = navigator.serviceWorker
    if (!registersServiceWorker(process.env.NODE_ENV)) {
      if (process.env.NODE_ENV === "production") {
        void sw.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister()))).catch(() => {})
      }
      return
    }

    let alive = true
    const onControllerChange = () => {
      if (!reloading.current) return
      reloading.current = false
      window.location.reload()
    }
    sw.addEventListener("controllerchange", onControllerChange)

    sw.register(serviceWorkerUrl(process.env.NEXT_PUBLIC_APP_VERSION), { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        // A new version is waiting only when an older one controls this page.
        const check = () => {
          if (alive && reg.waiting && sw.controller) setWaiting(reg.waiting)
        }
        check()
        reg.addEventListener("updatefound", () => {
          const next = reg.installing
          next?.addEventListener("statechange", () => next.state === "installed" && check())
        })
      })
      .catch(() => {}) // blocked or unsupported: the app works the same without it

    return () => {
      alive = false
      sw.removeEventListener("controllerchange", onControllerChange)
    }
  }, [])

  if (!waiting) return null
  return (
    <div
      role="status"
      className="on-dark fixed inset-x-4 bottom-[calc(var(--fc-layout-tab-bar-height)+1rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-xl bg-nav px-4 py-2 text-sm font-semibold text-nav-text shadow-raised md:right-6 md:bottom-6 md:left-auto md:mx-0"
    >
      <span>Update available</span>
      <Button
        type="button"
        variant="brand"
        size="sm"
        onClick={() => {
          reloading.current = true
          waiting.postMessage({ type: "SKIP_WAITING" })
        }}
      >
        Reload
      </Button>
    </div>
  )
}
