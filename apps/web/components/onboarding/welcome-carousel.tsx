"use client"

import { useEffect, useRef, useState } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "cn"

// First sign-in welcome (owner feedback 2026-11-20: "the welcome is too thin"): seven slides,
// each a picture, a title and a short paragraph. Desktop: a centred card ~720px wide. Phones
// (below md): a full-screen sheet; swipe left or right between slides. Arrow keys move, Escape
// and Skip (top right, every slide) skip; focus stays inside (Base UI dialog). The last slide
// offers "Show me around" (the nav tour) and "Start using FinCreador" (finish).
//
// Pictures: 3D-style scenes of the app with a made-up demo person (scripts/onboarding/scenes.ts,
// rendered by scripts/capture-onboarding.ts into public/onboarding/): a phone set (square) and a
// desktop set (16:10), chosen by <picture>. Only the current slide's and the next slide's
// pictures are in the page. Reduced motion: no slide animation.
//
// Every claim was checked against the app (2026-11-20): UPI import suggests a category per
// payment for review; Investments holds shares, mutual funds, ETFs and fixed deposits; goal
// types are trip, vehicle, house, furniture, electronics, mobile and other.

export type Slide = { slug: string; title: string; text: string; alt: string }

export const WELCOME_SLIDES: readonly Slide[] = [
  {
    slug: "welcome",
    title: "Welcome to FinCreador",
    text: "Your money, all in one place. FinCreador brings your bank accounts, cash, UPI apps, investments, loans and goals together, so you always know what you have, what you've spent and what's left this month.",
    alt: "The Overview page for a demo user, Ravi: money left this month, what came in and went out, surrounded by a bank account balance, UPI payments, the next loan EMI and a trip goal.",
  },
  {
    slug: "accounts",
    title: "Add your accounts",
    text: "Start with your bank accounts and cash. Enter today's balance once, and FinCreador keeps it up to date as you add income and expenses.",
    alt: "Three account cards, a savings account, a salary account and cash in hand, beside their total available balance and an add button.",
  },
  {
    slug: "track",
    title: "Track every rupee",
    text: "Add an expense in seconds, or import your Paytm, PhonePe, Google Pay or BHIM statement and review a suggested category for each payment. The statement file stays on your device.",
    alt: "The Add expense sheet with an amount and category choices, next to a UPI statement review where each payment has a suggested category, and a note that the file stays on this device.",
  },
  {
    slug: "investments",
    title: "See your investments",
    text: "Keep your mutual funds, shares, ETFs and fixed deposits in one list and see what they're worth together.",
    alt: "An investments list with a mutual fund, shares, an ETF and a fixed deposit, and their combined worth.",
  },
  {
    slug: "loans",
    title: "Stay on top of loans",
    text: "Track home, car, education and personal loans: what you still owe, your EMIs and when the next one is due.",
    alt: "A home loan showing the amount still owed, how much is repaid, the EMI and rate, and a calendar with the next EMI date.",
  },
  {
    slug: "goals",
    title: "Plan your goals",
    text: "Set a target, like a trip, a car or a home, and see how much to save each month to reach it on time.",
    alt: "A trip goal 58% saved, with the amount to save each month to reach it on time and a what-if line.",
  },
  {
    slug: "roma",
    title: "Ask Roma",
    text: "Roma is your money assistant. Ask how much went on food last month, whether you're on track for a goal, or how the new tax regime works. She answers from your own records and checked sources.",
    alt: "A chat with Roma: asked how much went on food last month, she answers with the total for October and the period and entries it came from.",
  },
]

const SWIPE = 50

function SlidePicture({ slide, alt }: { slide: Slide; alt: string }) {
  return (
    <picture>
      <source media="(max-width: 767px)" srcSet={`/onboarding/${slide.slug}-phone.webp`} width={780} height={780} />
      {/* A plain <img> in <picture>: the phone and desktop sets are different crops (art direction). */}
      <img src={`/onboarding/${slide.slug}-desktop.webp`} width={1200} height={750} alt={alt} decoding="async" className="size-full object-cover" />
    </picture>
  )
}

export function WelcomeCarousel({ onTour, onClosed, onFinish }: { onTour: () => void; onClosed: () => void; onFinish: () => Promise<unknown> }) {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [saving, setSaving] = useState(false)
  const next = useRef<HTMLButtonElement>(null)
  const start = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const count = WELCOME_SLIDES.length
  const last = index === count - 1
  const slide = WELCOME_SLIDES[index]!
  const upcoming = WELCOME_SLIDES[index + 1]

  const go = (to: number) => {
    if (to < 0 || to >= count || to === index) return
    setDirection(to > index ? 1 : -1)
    setIndex(to)
  }

  // Skip and "Start using FinCreador": saved to the profile before it closes.
  const finish = async () => {
    if (saving) return
    setSaving(true)
    await onFinish().catch(() => null)
    onClosed()
  }

  // The button the person was on can disappear (Next on the last slide, Back on the first):
  // keep focus on the main action, never on the page behind.
  useEffect(() => {
    const active = document.activeElement
    const usable = active instanceof HTMLElement && active !== popup.current && !(active instanceof HTMLButtonElement && active.disabled)
    if (usable && popup.current?.contains(active)) return
    ;(last ? start : next).current?.focus()
  }, [index, last])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault()
      go(index + 1)
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      go(index - 1)
    }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const from = touch.current
    touch.current = null
    const t = e.changedTouches[0]
    if (!from || !t) return
    const dx = t.clientX - from.x
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(t.clientY - from.y)) return
    go(dx < 0 ? index + 1 : index - 1)
  }

  return (
    <DialogPrimitive.Root open disablePointerDismissal onOpenChange={(open) => !open && void finish()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-60 bg-ink/45" />
        <DialogPrimitive.Viewport className="fixed inset-0 z-60 grid md:place-items-center md:p-4">
          <DialogPrimitive.Popup
            ref={popup}
            initialFocus={next}
            aria-label="Welcome to FinCreador"
            data-testid="welcome"
            onKeyDown={onKeyDown}
            onTouchStart={(e) => {
              const t = e.touches[0]
              touch.current = t ? { x: t.clientX, y: t.clientY } : null
            }}
            onTouchEnd={onTouchEnd}
            className="relative flex h-dvh w-full flex-col gap-4 overflow-y-auto bg-surface px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] text-ink outline-none md:h-auto md:max-h-[calc(100dvh-2rem)] md:w-[720px] md:max-w-full md:rounded-3xl md:p-6 md:shadow-(--shadow-raised)"
          >
            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="md" disabled={saving} onClick={() => void finish()}>
                Skip
              </Button>
            </div>

            <div
              key={index}
              data-testid="welcome-slide"
              data-slide={slide.slug}
              className={cn(
                "grid gap-4 duration-300 animate-in fade-in-0 motion-reduce:animate-none",
                direction === 1 ? "slide-in-from-right-8" : "slide-in-from-left-8"
              )}
            >
              <div className="aspect-square overflow-hidden rounded-2xl bg-canvas shadow-(--shadow-raised) md:aspect-[16/10]">
                <SlidePicture slide={slide} alt={slide.alt} />
              </div>
              <div className="grid gap-2">
                <h2 className="font-heading text-xl font-semibold tracking-(--fc-tracking-heading) md:text-2xl">{slide.title}</h2>
                <p className="text-sm leading-relaxed md:text-base">{slide.text}</p>
              </div>
            </div>

            {/* The next slide's picture, so it's ready when Next is pressed. Nothing else is loaded. */}
            {upcoming && (
              <div hidden aria-hidden="true">
                <SlidePicture slide={upcoming} alt="" />
              </div>
            )}

            <p className="sr-only" aria-live="polite">
              Slide {index + 1} of {count}: {slide.title}
            </p>

            <div className="mt-auto grid gap-4 md:mt-0">
              <div aria-hidden="true" data-testid="welcome-dots" className="flex justify-center gap-1.5">
                {WELCOME_SLIDES.map((s, i) => (
                  <span key={s.slug} className={cn("h-2 rounded-full transition-[width] motion-reduce:transition-none", i === index ? "w-5 bg-brand-deep" : "w-2 bg-line-strong")} />
                ))}
              </div>
              {/* Last slide on phones: Back and Show me around side by side, Start full width below. */}
              <div className={cn("gap-2", last ? "grid grid-cols-2 md:flex md:justify-end" : "flex justify-between")}>
                <Button type="button" variant="secondary" size="lg" disabled={index === 0 || saving} onClick={() => go(index - 1)} className={cn(last && "md:mr-auto")}>
                  Back
                </Button>
                {last ? (
                  <>
                    <Button type="button" variant="secondary" size="lg" disabled={saving} onClick={onTour}>
                      Show me around
                    </Button>
                    <Button ref={start} type="button" size="lg" disabled={saving} onClick={() => void finish()} className="col-span-2">
                      Start using FinCreador
                    </Button>
                  </>
                ) : (
                  <Button ref={next} type="button" size="lg" disabled={saving} onClick={() => go(index + 1)}>
                    Next
                  </Button>
                )}
              </div>
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
