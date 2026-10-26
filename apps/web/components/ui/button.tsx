import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent font-semibold whitespace-nowrap transition-colors select-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** Dark ink — main action ("Add transaction", "Save"). */
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
        sm: "h-[30px] px-2.5 text-sm",
        md: "h-[36px] px-3.5 text-sm",
        lg: "h-[40px] px-4 text-base",
        /** 44px touch target. */
        icon: "size-[36px]",
        "icon-sm": "size-[30px]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

type IconSize = "icon" | "icon-sm"

type BaseProps = Omit<ButtonPrimitive.Props, "className"> & {
  className?: string
  variant?: VariantProps<typeof buttonVariants>["variant"]
}

/** Icon-only buttons must have an accessible name (design-spec §3). */
export type ButtonProps =
  | (BaseProps & { size?: Exclude<VariantProps<typeof buttonVariants>["size"], IconSize> })
  | (BaseProps & { size: IconSize; "aria-label": string })

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
