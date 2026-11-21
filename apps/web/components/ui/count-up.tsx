"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { countUpValue, formatMoney } from "@fin-creador/domain"

// Counting a money figure from one server value to the next (balance feedback). Display only:
// both ends come from the server, the frames between are whole minor units, and the last frame
// is exactly the new value. Under prefers-reduced-motion there is no counting.

const REDUCED = "(prefers-reduced-motion: reduce)"

function subscribe(onChange: () => void) {
  const query = window.matchMedia(REDUCED)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(REDUCED).matches, () => true)
}

/** How long a count takes (balance card and Total available), eased out. */
export const COUNT_MS = 1500

/** The figure to show while counting from `from` to `to` over `durationMs`, after `delayMs`. */
export function useCountUp(from: number, to: number, durationMs = COUNT_MS, delayMs = 0): number {
  const reduced = usePrefersReducedMotion()
  const still = reduced || from === to
  const key = `${from}:${to}`
  // The latest frame of the current count (a frame of an earlier count is ignored).
  const [frame, setFrame] = useState<{ key: string; value: number } | null>(null)

  useEffect(() => {
    if (still) return
    let id = 0
    const start = performance.now() + delayMs
    const tick = (now: number) => {
      const progress = Math.max(0, now - start) / durationMs
      setFrame({ key, value: countUpValue(from, to, progress) })
      if (progress < 1) id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [still, key, from, to, durationMs, delayMs])

  if (still) return to
  return frame?.key === key ? frame.value : from
}

// The last figure each AnimatedAmount showed in this tab (memory only, never stored), so a page
// opened after a save elsewhere counts from what the person last saw to the new value.
const lastShown = new Map<string, { minor: number; currency: string }>()

/**
 * A server figure that counts to its new value when it changes (Total available on Income and
 * Overview). `id` names the figure; the first time it is shown there is nothing to count from.
 * Screen readers get only the final value.
 */
/** `twoDecimals`: always show the minor units (₹1,33,390.00), as on the Income page. */
export function AnimatedAmount({ id, minor, currency, twoDecimals = false }: { id: string; minor: number; currency: string; twoDecimals?: boolean }) {
  const [range, setRange] = useState(() => {
    const last = lastShown.get(id)
    return { from: last && last.currency === currency ? last.minor : minor, to: minor }
  })
  // A new server value while the page stays open: count on from the last target.
  if (range.to !== minor) setRange({ from: range.to, to: minor })
  const shown = useCountUp(range.from, range.to)

  useEffect(() => {
    lastShown.set(id, { minor, currency })
  }, [id, minor, currency])

  return (
    <>
      <span aria-hidden="true" data-testid={`amount-${id}`} data-value={minor}>
        {formatMoney(shown, { currency, trimZeroFraction: !twoDecimals })}
      </span>
      <span className="sr-only">{formatMoney(minor, { currency, trimZeroFraction: !twoDecimals })}</span>
    </>
  )
}
