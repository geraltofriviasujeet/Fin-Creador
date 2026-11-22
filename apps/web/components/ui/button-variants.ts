import { cva } from "class-variance-authority"

// Button styles, kept apart from <Button> (a client component, components/ui/button.tsx) so
// server components can call buttonVariants for links styled as buttons.

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent font-semibold whitespace-nowrap transition-colors select-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** Dark ink — main action ("Add expense", "Save"). */
        primary: "bg-primary text-primary-foreground hover:bg-ink/90",
        /** White with border — secondary action ("Cancel"). */
        secondary: "border-line bg-surface text-ink hover:bg-canvas",
        ghost: "text-ink hover:bg-canvas",
        /** Lime fill with ink text — highlight action. */
        brand: "bg-brand text-ink hover:bg-brand/85",
        destructive: "bg-danger text-white hover:bg-danger/90",
        link: "h-auto px-0 text-ink underline underline-offset-4 hover:no-underline",
      },
      size: {
        sm: "h-[44px] px-2.5 text-sm md:h-[30px]",
        md: "h-[44px] px-3.5 text-sm md:h-[36px]",
        lg: "h-[44px] px-4 text-base md:h-[40px]",
        /** 44px touch target. */
        icon: "size-[44px] md:size-[36px]",
        "icon-sm": "size-[44px] md:size-[30px]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)
