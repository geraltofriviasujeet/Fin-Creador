import type * as React from "react"
import { Card } from "@/components/ui/card"

/** One summary card on the Income page: label, big figure, footer line. */
export function StatCard({ label, value, footer }: { label: string; value: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Card className="flex min-w-[245px] snap-start flex-col gap-3 md:min-w-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-heading text-3xl font-semibold tracking-(--fc-tracking-heading) tabular-nums md:text-4xl">{value}</p>
      {footer && <div className="text-sm text-muted-foreground">{footer}</div>}
    </Card>
  )
}
