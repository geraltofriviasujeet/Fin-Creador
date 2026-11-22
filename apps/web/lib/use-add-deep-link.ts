"use client"

import { useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"

/**
 * Consumes an `?add=` deep link once (the topbar Add menu links to /transactions?add=…, the
 * Income page also takes ?add=income|bank).
 *
 * With cacheComponents, Next keeps visited pages mounted but hidden (React Activity), and a
 * hidden page still re-renders with the current URL's search params. Reading `?add=` while
 * rendering therefore let a hidden page open its own dialog (Sprint 12a-1 bug). So:
 * - it is read in an Effect, which never runs while the page is hidden;
 * - only when the real URL is this page (`route`) and still carries the same `add`;
 * - and the param is removed from the URL straight away (replaceState keeps the other params),
 *   so neither the router cache, back/forward nor a refresh can open the dialog again.
 * Dialogs opened this way keep their type in component state, never in the URL.
 */
export function useAddDeepLink<T extends string>(route: string, allowed: readonly T[], open: (type: T) => void) {
  const add = useSearchParams().get("add")
  const openRef = useRef(open)
  const allowedRef = useRef(allowed)
  useEffect(() => {
    openRef.current = open
    allowedRef.current = allowed
  })
  useEffect(() => {
    if (!add) return
    const url = new URL(window.location.href)
    if (url.pathname !== route || url.searchParams.get("add") !== add) return
    url.searchParams.delete("add")
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
    if ((allowedRef.current as readonly string[]).includes(add)) openRef.current(add as T)
  }, [add, route])
}
