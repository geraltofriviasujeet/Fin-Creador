"use client"

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { closeWelcomeAction } from "@/app/(app)/onboarding/actions"
import { NAV_ITEMS } from "@/components/shell/nav-items"
import { Button } from "@/components/ui/button"
import { REPLAY_WELCOME_EVENT, WelcomeCarousel } from "@/components/onboarding/welcome-carousel"
import { cn } from "cn"

// The welcome and the tour (before Sprint 12a). The welcome carousel (welcome-carousel.tsx)
// shows after each sign-in unless the person opted out; closing it clears this sign-in's cookie,
// so a reload never brings it back. Its last slide's "Show me around" starts the tour, which
// walks the + Add button and every main nav item, in nav order, without leaving the page. No
// library: each step points at an element marked data-tour="…" in the shell (topbar, sidebar,
// tab bar), so every step exists on every page. When several elements carry the same name
// (sidebar link and tab-bar link), the visible one is used; a step whose element isn't on screen
// is skipped (the sidebar's items on phones, the tab bar's "More" on desktop). On desktop the
// card sits beside the item with an arrow; on phones (≤ 760px, the tab-bar layout) it is a card
// above the tab bar. Settings → Replay the tour opens the carousel on slide 1.

type Step = { anchor: string; title: string; text: string; phoneTitle?: string; phoneText?: string }

// What each nav item's step says: the page and its one or two standout features.
const NAV_TEXT: Record<string, { text: string; phoneText?: string }> = {
  overview: { text: "This month at a glance: what came in, what went out and what's left." },
  income: { text: "Your bank and cash accounts with their total available, and where your income comes from." },
  recurring: { text: "Salary, rent and subscriptions that repeat. Nothing is saved until you confirm it." },
  transactions: {
    text: "Every entry, with search and filters. Import a UPI statement from Paytm, PhonePe, BHIM or Google Pay.",
    phoneText: "Every entry, with search. Import a UPI statement here, and see what's coming up from Recurring.",
  },
  goals: { text: "Plan a trip, a car or a home and see how much to save each month. Set monthly budgets too." },
  investments: { text: "Shares, mutual funds and ETFs at the last closing price, and fixed deposits valued today." },
  loans: { text: "Loans, credit cards and EMIs, with what's due next. Import a card statement." },
  reports: { text: "Month by month: money in, money out and net worth. Download your entries as CSV." },
  roma: { text: "Ask Roma about your money in plain words, or check whether a goal or a trip fits." },
}

export const TOUR_STEPS: readonly Step[] = [
  {
    anchor: "add",
    title: "Add",
    text: "Add expense saves a spend in seconds. The arrow beside it adds income, a transfer or a refund, or imports a UPI statement.",
    phoneText: "+ adds an expense in seconds. The arrow beside it adds income, a transfer or a refund, or imports a UPI statement.",
  },
  ...NAV_ITEMS.filter((item) => item.available && NAV_TEXT[item.key]).map((item) => ({
    anchor: item.key,
    title: item.label,
    phoneTitle: item.tabLabel,
    ...NAV_TEXT[item.key]!,
  })),
  // Phones only: the tab bar's More (the sidebar has no such item).
  {
    anchor: "more",
    title: "More",
    text: "Income and accounts, Recurring, Loans & Liabilities, Reports and Ask Roma. Settings is the gear at the top.",
  },
]

const PHONE = "(max-width: 760px)"
const GAP = 12
const ARROW = 8
const CARD_WIDTH = 320
// The highlight ring's distance from the element, and from the window's edge.
const RING_PAD = 4
const EDGE = 2

function visibleAnchor(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    if (el.getClientRects().length > 0) return el
  }
  return null
}

type Box = { top: number; left: number; width: number; height: number }
type Placement = { side: "right" | "bottom"; top: number; left: number; arrow: number }

type Stage = "welcome" | "tour" | "closed"

export function Onboarding({ show }: { show: boolean }) {
  const [stage, setStage] = useState<Stage>(show ? "welcome" : "closed")
  // Settings → Replay the tour: opens the welcome on slide 1 (a fresh carousel each time).
  useEffect(() => {
    const open = () => setStage("welcome")
    window.addEventListener(REPLAY_WELCOME_EVENT, open)
    return () => window.removeEventListener(REPLAY_WELCOME_EVENT, open)
  }, [])
  const close = useCallback(() => setStage("closed"), [])
  if (stage === "welcome") return <WelcomeCarousel onTour={() => setStage("tour")} onClosed={close} onClose={closeWelcomeAction} />
  if (stage === "tour") return <TourSteps onClosed={close} />
  return null
}

function TourSteps({ onClosed }: { onClosed: () => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const [phone, setPhone] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const textId = useId()

  // Nothing to save: the welcome saved "Don't show this again" (if ticked) when it closed.
  const finish = useCallback(() => {
    document.getElementById("main")?.focus()
    onClosed()
  }, [onClosed])

  // Which steps have an element on screen, decided once when the tour opens (after a frame, so
  // the page has laid out).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const available = TOUR_STEPS.filter((s) => visibleAnchor(s.anchor))
      if (available.length === 0) finish()
      else setSteps(available)
    })
    return () => cancelAnimationFrame(id)
  }, [finish])

  const step = steps?.[index]

  // Keep the highlight and the card on the step's element (resize, scroll, layout changes).
  useLayoutEffect(() => {
    if (!step) return
    const measure = () => {
      const isPhone = window.matchMedia(PHONE).matches
      setPhone(isPhone)
      const el = visibleAnchor(step.anchor)
      if (!el) {
        setBox(null)
        setPlacement(null)
        return
      }
      const r = el.getBoundingClientRect()
      const next = { top: r.top, left: r.left, width: r.width, height: r.height }
      setBox(next)
      setPlacement(isPhone ? null : desktopPlacement(next, el.closest("aside") !== null, card.current?.offsetHeight ?? 200))
    }
    measure()
    // Once more after the card has its height for this step's text.
    const id = requestAnimationFrame(measure)
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      cancelAnimationFrame(id)
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
  const title = phone && step.phoneTitle ? step.phoneTitle : step.title

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault()
      finish()
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

  const beside = !phone && placement !== null

  return createPortal(
    <div className="fixed inset-0 z-60" data-testid="tour">
      {/* Blocks the page while the tour is open; the highlight dims everything around the element. */}
      <div className="absolute inset-0" aria-hidden="true" />
      {box && <Highlight box={box} />}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-side={beside ? placement.side : "sheet"}
        style={beside ? { top: placement.top, left: placement.left } : undefined}
        className={cn(
          "fixed grid gap-3 rounded-2xl border border-line bg-surface p-4 text-ink shadow-(--shadow-raised) outline-none",
          beside
            ? "w-80"
            : "inset-x-4 bottom-[calc(var(--fc-layout-tab-bar-height)+env(safe-area-inset-bottom)+0.75rem)] md:inset-x-auto md:right-6 md:bottom-6 md:w-80"
        )}
      >
        {beside && <Arrow placement={placement} />}
        <p className="text-xs font-semibold text-muted-foreground">
          {index + 1} of {steps.length}
        </p>
        <h2 id={titleId} className="text-base font-semibold">
          <span className="sr-only">
            Tour, step {index + 1} of {steps.length}:{" "}
          </span>
          {title}
        </h2>
        <p id={textId} className="text-sm">
          {phone && step.phoneText ? step.phoneText : step.text}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="md" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
            Back
          </Button>
          <Button type="button" size="md" onClick={() => (last ? finish() : setIndex((i) => i + 1))}>
            {last ? "Done" : "Next"}
          </Button>
          <Button type="button" variant="ghost" size="md" className="ml-auto" onClick={finish}>
            Skip tour
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/**
 * The ring around the step's element, dimming the rest. Kept inside the window (an item at the
 * edge, like "More" at 360px, gets a ring that stops at the edge instead of being cut off), and
 * drawn inside its own box so nothing of it falls outside.
 */
function Highlight({ box }: { box: Box }) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.max(EDGE, box.left - RING_PAD)
  const top = Math.max(EDGE, box.top - RING_PAD)
  const right = Math.min(vw - EDGE, box.left + box.width + RING_PAD)
  const bottom = Math.min(vh - EDGE, box.top + box.height + RING_PAD)
  return (
    <div
      aria-hidden="true"
      data-testid="tour-highlight"
      className="pointer-events-none fixed rounded-xl outline-2 -outline-offset-2 outline-brand"
      style={{ top, left, width: right - left, height: bottom - top, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)" }}
    />
  )
}

/**
 * A small diamond on the card's edge, pointing at the element. Positions are from the card's
 * padding edge, so the card's 1px border is taken off to centre it on `placement.arrow`.
 */
function Arrow({ placement }: { placement: Placement }) {
  const half = ARROW / 2 + 1
  const style: React.CSSProperties =
    placement.side === "right"
      ? { left: -half - 1, top: placement.arrow - half - 1 }
      : { top: -half - 1, left: placement.arrow - half - 1 }
  return (
    <span
      aria-hidden="true"
      data-testid="tour-arrow"
      style={{ ...style, width: half * 2, height: half * 2 }}
      className={cn(
        "absolute rotate-45 border-line bg-surface",
        placement.side === "right" ? "border-b border-l" : "border-t border-l"
      )}
    />
  )
}

/**
 * Desktop: beside a sidebar item (to its right, centred on it), else below a top-bar item
 * (right edges lined up). Never over the item; always inside the window. `arrow` is where the
 * item's centre falls along the card's edge.
 */
function desktopPlacement(box: Box, inSidebar: boolean, cardHeight: number): Placement {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clamp = (x: number, min: number, max: number) => Math.min(Math.max(min, x), Math.max(min, max))
  if (inSidebar) {
    const centre = box.top + box.height / 2
    const top = clamp(centre - cardHeight / 2, GAP, vh - cardHeight - GAP)
    return { side: "right", left: box.left + box.width + GAP, top, arrow: clamp(centre - top, 16, cardHeight - 16) }
  }
  const centre = box.left + box.width / 2
  const left = clamp(box.left + box.width - CARD_WIDTH, GAP, vw - CARD_WIDTH - GAP)
  return { side: "bottom", left, top: box.top + box.height + GAP, arrow: clamp(centre - left, 16, CARD_WIDTH - 16) }
}
