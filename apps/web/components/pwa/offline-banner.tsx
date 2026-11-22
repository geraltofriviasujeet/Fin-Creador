"use client"

import { WifiOff } from "lucide-react"
import { OFFLINE_REASON, useOnline } from "./pwa-provider"

/**
 * "You're offline · Saving is paused" above every app page while the device is offline
 * (Sprint 12b). Save and Add are disabled meanwhile (components/ui/button.tsx).
 */
export function OfflineBanner() {
  const online = useOnline()
  return (
    <div role="status" aria-live="polite" className="contents">
      {!online && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink">
          <WifiOff aria-hidden="true" className="size-4 shrink-0" />
          {OFFLINE_REASON}
        </p>
      )}
    </div>
  )
}
