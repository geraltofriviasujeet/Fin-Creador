import type * as React from "react"
import { cn } from "cn"

type CardProps = React.ComponentProps<"div"> & {
  /** "deep": dark forest-green feature card (e.g. Total balance) with lime focus ring. */
  tone?: "default" | "deep"
}

function Card({ className, tone = "default", ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-2xl border p-4 md:p-5",
        tone === "default" && "border-line bg-surface text-ink",
        tone === "deep" && "on-dark border-transparent bg-brand-deep text-nav-text",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-header" className={cn("flex items-start justify-between gap-3", className)} {...props} />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="card-title" className={cn("font-heading text-xl font-semibold", className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("mt-4", className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("mt-4 flex items-center justify-between gap-3 border-t border-line pt-3", className)}
      {...props}
    />
  )
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
