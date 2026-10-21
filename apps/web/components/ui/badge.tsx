import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Tone carries meaning (good/bad), not the sign. Callers always include a visible
// "+"/"−" or text so meaning never depends on colour alone (design-spec §3).
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums",
  {
    variants: {
      tone: {
        positive: "bg-chip-mint text-success",
        negative: "bg-chip-peach text-danger",
        savings: "bg-chip-lavender text-ink",
        info: "bg-chip-blue text-ink",
        neutral: "bg-canvas text-muted-foreground",
        /** On dark cards: lime text on translucent white. */
        onDark: "bg-white/10 text-brand",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
)

function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />
}

export { Badge, badgeVariants }
