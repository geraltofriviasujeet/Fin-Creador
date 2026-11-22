"use client"

import { useEffect } from "react"

// While a phone sheet is open, the visible part of the screen (the visual viewport: what the
// on-screen keyboard leaves) is published as two CSS variables on <html>:
//   --fc-vvh     its height in px
//   --fc-vv-top  how far it is scrolled down the layout viewport (iOS pans it to the input)
// The dialog's phone sheet sits inside that box, so Save stays above the keyboard. Without
// visualViewport (old browsers) the variables are unset and the sheet falls back to 100dvh.

let openSheets = 0

export function visualViewportVars(vv: { height: number; offsetTop: number }) {
  return { "--fc-vvh": `${Math.round(vv.height)}px`, "--fc-vv-top": `${Math.round(Math.max(0, vv.offsetTop))}px` }
}

export function useVisualViewportVars() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const update = () => {
      for (const [name, value] of Object.entries(visualViewportVars(vv))) root.style.setProperty(name, value)
    }
    openSheets += 1
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
      openSheets -= 1
      // A confirm step over an edit sheet: keep the variables until the last sheet closes.
      if (openSheets === 0) {
        root.style.removeProperty("--fc-vvh")
        root.style.removeProperty("--fc-vv-top")
      }
    }
  }, [])
}
