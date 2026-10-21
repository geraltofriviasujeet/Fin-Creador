import Link from "next/link"
import { logo } from "@fin-creador/design-tokens"
import { cn } from "cn"

// Open "C" ring: an arc around the centre with its gap centred on the left (180°).
function ringPath() {
  const c = logo.size / 2
  const r = logo.ringRadius
  const half = logo.ringGapDeg / 2
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180
    return `${(c + r * Math.cos(rad)).toFixed(3)} ${(c + r * Math.sin(rad)).toFixed(3)}`
  }
  // From the upper end of the gap, clockwise the long way round to the lower end.
  return `M ${point(180 + half)} A ${r} ${r} 0 1 1 ${point(180 - half)}`
}

const RING = ringPath()

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
 * "Fin" + "Creador" in Manrope 700. On dark: white + lime (spec).
 * On light: all ink, because lime text on white fails contrast.
 */
export function Wordmark({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      className={cn("font-heading text-xl leading-none font-bold tracking-(--fc-tracking-wordmark)", className)}
    >
      <span className="sr-only">Fin Creador</span>
      <span aria-hidden="true" className={tone === "onDark" ? "text-nav-text" : "text-ink"}>
        Fin
        <span className={tone === "onDark" ? "text-brand" : "text-ink"}>Creador</span>
      </span>
    </span>
  )
}

/** Mark + wordmark, linking home. */
export function Logo({ tone, href = "/", className }: { tone: Tone; href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 rounded-lg", className)}>
      <LogoMark />
      <Wordmark tone={tone} />
    </Link>
  )
}
