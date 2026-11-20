"use client"

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { finishTourAction } from "@/app/(app)/onboarding/actions"
import { Button } from "@/components/ui/button"

// First sign-in tour (before Sprint 12a). No library: each step points at an element marked
// data-tour="…" in the shell (topbar, sidebar, tab bar), so every step exists on every page.
// When several elements carry the same name (sidebar link and tab-bar link), the visible one is
// used; a step whose element isn't on screen is skipped. On phones (≤ 760px, the tab-bar layout)
// the step is a card above the tab bar. Finishing or skipping is saved to the profile before the
// tour closes, so a reload never brings it back.

type Step = { anchor: string; title: string; text: string; phoneText?: string }

export const TOUR_STEPS: readonly Step[] = [
  { anchor: "add-expense", title: "Add expense", text: "Spent something? Add it here in a few seconds." },
  { anchor: "import-upi", title: "Import a UPI statement", text: "Open this menu to add income, a transfer, or import a UPI statement." },
  { anchor: "overview", title: "Overview", text: "See what came in, what went out and what's left this month." },
  { anchor: "goals", title: "Goals", text: "Save for a trip, a home or an emergency fund, and set budgets." },
  { anchor: "roma", title: "Ask Roma", text: "Ask Roma about your money in plain words.", phoneText: "Ask Roma about your money. She's under More." },
]

const PHONE = "(max-width: 760px)"
const GAP = 12
const CARD_WIDTH = 320

function visibleAnchor(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    if (el.getClientRects().length > 0) return el
  }
  return null
}

type Box = { top: number; left: number; width: number; height: number }

export function Tour({ show }: { show: boolean }) {
  const [open, setOpen] = useState(show)
  // Settings → Replay the tour: the layout re-renders with show = true.
  const [lastShow, setLastShow] = useState(show)
  if (show !== lastShow) {
    setLastShow(show)
    if (show) setOpen(true)
  }
  const close = useCallback(() => setOpen(false), [])
  return open ? <TourSteps onClosed={close} /> : null
}

function TourSteps({ onClosed }: { onClosed: () => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [phone, setPhone] = useState(false)
  const [saving, setSaving] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const textId = useId()

  const finish = useCallback(async () => {
    setSaving(true)
    await finishTourAction().catch(() => null)
    returnFocus.current?.focus?.()
    onClosed()
  }, [onClosed])

  // Which steps have an element on screen, decided once when the tour opens (after a frame, so
  // the page has laid out).
  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null
    const id = requestAnimationFrame(() => {
      const available = TOUR_STEPS.filter((s) => visibleAnchor(s.anchor))
      if (available.length === 0) void finish()
      else setSteps(available)
    })
    return () => cancelAnimationFrame(id)
  }, [finish])

  const step = steps?.[index]

  // Keep the highlight and the card on the step's element (resize, scroll, layout changes).
  useLayoutEffect(() => {
    if (!step) return
    const measure = () => {
      setPhone(window.matchMedia(PHONE).matches)
      const el = visibleAnchor(step.anchor)
      if (!el) return setBox(null)
      const r = el.getBoundingClientRect()
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [step])

  // Each step: focus the card, so screen readers read its title and sentence.
  useEffect(() => {
    if (step) card.current?.focus()
  }, [step])

  if (!steps || !step) return null
  const last = index === steps.length - 1

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      if (!saving) void finish()
      return
    }
    if (e.key !== "Tab") return
    // Keep focus in the card while the tour is open.
    const focusable = [...(card.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])]
    if (focusable.length === 0) return
    const first = focusable[0]!
    const end = focusable[focusable.length - 1]!
    if (e.shiftKey && (document.activeElement === first || document.activeElement === card.current)) {
      e.preventDefault()
      end.focus()
    } else if (!e.shiftKey && document.activeElement === end) {
      e.preventDefault()
      first.focus()
    }
  }

  const cardStyle: React.CSSProperties | undefined = phone || !box ? undefined : desktopPosition(box)

  return createPortal(
    <div className="fixed inset-0 z-60" data-testid="tour">
      {/* Blocks the page while the tour is open; the highlight dims everything around the element. */}
      <div className="absolute inset-0" aria-hidden="true" />
      {box && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-xl outline-2 outline-offset-2 outline-brand"
          style={{
            top: box.top - 4,
            left: box.left - 4,
            width: box.width + 8,
            height: box.height + 8,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)",
          }}
        />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={cardStyle}
        className={
          phone || !box
            ? "fixed inset-x-4 bottom-[calc(var(--fc-layout-tab-bar-height)+env(safe-area-inset-bottom)+0.75rem)] grid gap-3 rounded-2xl border border-line bg-surface p-4 text-ink shadow-(--shadow-raised) outline-none md:inset-x-auto md:right-6 md:bottom-6 md:w-80"
            : "fixed grid w-80 gap-3 rounded-2xl border border-line bg-surface p-4 text-ink shadow-(--shadow-raised) outline-none"
        }
      >
        <p className="text-xs font-semibold text-muted-foreground">
          {index + 1} of {steps.length}
        </p>
        <h2 id={titleId} className="text-base font-semibold">
          <span className="sr-only">
            Tour, step {index + 1} of {steps.length}:{" "}
          </span>
          {step.title}
        </h2>
        <p id={textId} className="text-sm">
          {phone && step.phoneText ? step.phoneText : step.text}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="md" disabled={index === 0 || saving} onClick={() => setIndex((i) => i - 1)}>
            Back
          </Button>
          <Button type="button" size="md" disabled={saving} onClick={() => (last ? void finish() : setIndex((i) => i + 1))}>
            {last ? "Done" : "Next"}
          </Button>
          <Button type="button" variant="ghost" size="md" className="ml-auto" disabled={saving} onClick={() => void finish()}>
            Skip tour
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Beside a sidebar item, else below the element; always inside the window. */
function desktopPosition(box: Box): React.CSSProperties {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampLeft = (x: number) => Math.min(Math.max(GAP, x), vw - CARD_WIDTH - GAP)
  const inSidebar = box.left + box.width < vw / 3 && box.top > 80
  if (inSidebar) return { left: clampLeft(box.left + box.width + GAP), top: Math.min(Math.max(GAP, box.top - 8), vh - 220) }
  return { left: clampLeft(box.left + box.width - CARD_WIDTH), top: Math.min(box.top + box.height + GAP, vh - 220) }
}
