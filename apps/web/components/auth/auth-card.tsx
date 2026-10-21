import type * as React from "react"
import Link from "next/link"
import { Card } from "@/components/ui/card"

/** Shared frame for auth screens: heading, description, form, footer link. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <Card className="grid gap-6 p-6 shadow-raised md:p-8">
      <div className="grid gap-1.5">
        <h1 className="text-2xl font-semibold tracking-(--fc-tracking-heading)">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
      {footer && <p className="text-center text-sm text-muted-foreground">{footer}</p>}
    </Card>
  )
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded font-semibold text-ink underline underline-offset-4 hover:no-underline">
      {children}
    </Link>
  )
}
