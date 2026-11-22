import Link from "next/link"
import { logo, logoRingPath } from "@fin-creador/design-tokens"
import { cn } from "cn"

const RING = logoRingPath()

/** 28px lime rounded square, rotated −6°, with a dark open ring (design-spec §1). Decorative. */
export function LogoMark({ className, size = logo.size }: { className?: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox={`0 0 ${logo.size} ${logo.size}`}
      overflow="visible"
      className={cn("shrink-0", className)}
    >
      <g transform={`rotate(${logo.rotationDeg} ${logo.size / 2} ${logo.size / 2})`}>
        <rect width={logo.size} height={logo.size} rx={logo.cornerRadius} className="fill-brand" />
        <path
          d={RING}
          fill="none"
          strokeWidth={logo.ringStroke}
          strokeLinecap="round"
          className="stroke-ink"
        />
      </g>
    </svg>
  )
}

type Tone = "onDark" | "onLight"

/**
 * "Fin" + "Creador" (FinCreador) in Manrope 700. On dark: white + lime.
 * On light: all ink, because lime text on white fails contrast. Screen readers hear the
 * visually hidden "FinCreador"; the styled wordmark is hidden from them.
 */
export function Wordmark({ tone, className, visibleClassName }: { tone: Tone; className?: string; visibleClassName?: string }) {
  return (
    <span
      className={cn("font-heading text-xl leading-none font-bold tracking-(--fc-tracking-wordmark)", className)}
    >
      <span className="sr-only">FinCreador</span>
      <span aria-hidden="true" className={cn(tone === "onDark" ? "text-nav-text" : "text-ink", visibleClassName)}>
        Fin
        <span className={tone === "onDark" ? "text-brand" : "text-ink"}>Creador</span>
      </span>
    </span>
  )
}

/**
 * Mark + wordmark, linking home. `markOnlyOnSmallPhones` hides the visible wordmark below
 * 440px (the phone topbar's buttons need the room); screen readers still hear "FinCreador".
 */
export function Logo({ tone, href = "/", className, markOnlyOnSmallPhones = false }: { tone: Tone; href?: string; className?: string; markOnlyOnSmallPhones?: boolean }) {
  return (
    <Link href={href} className={cn("inline-flex min-h-[44px] min-w-[44px] items-center gap-2.5 rounded-lg md:min-h-0 md:min-w-0", className)}>
      <LogoMark />
      <Wordmark tone={tone} visibleClassName={markOnlyOnSmallPhones ? "max-[439px]:hidden" : undefined} />
    </Link>
  )
}
