import { cn } from "cn"

// Horizontal bar chart for the Income page (plain HTML, no chart library, like the Overview's
// SVG charts). Every bar has its name and amount in text beside it, so colour is never the only
// way to read it. Geometry comes from the server in basis points of the plot width; negative
// values draw left of the zero line.

/** Income source colours, by chart index (0–5); "Other" and accounts not in the total are grey. */
export const SERIES = ["bg-chart", "bg-brand-deep", "bg-chart-teal", "bg-chart-blue", "bg-chart-amber", "bg-danger-fill"] as const
export const OTHER = "bg-line-strong"

export type BarItem = {
  key: string
  label: string
  /** The amount as text, shown beside the bar. */
  amount: string
  /** Null: no bar (e.g. another currency), the row still shows label and amount. */
  startBp: number | null
  lengthBp: number
  colorClass: string
  note?: string
}

const pct = (bp: number) => `${bp / 100}%`

export function BarChart({ label, items, zeroBp }: { label: string; items: BarItem[]; zeroBp: number }) {
  return (
    // Rows alternate white and canvas (owner review 2026-11-21); the track is white on a
    // canvas row so it still shows.
    <ul className="grid gap-1" aria-label={label}>
      {items.map((item) => (
        <li
          key={item.key}
          data-bar={item.key}
          className="group grid rounded-lg px-3 py-2 even:bg-canvas grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 min-[641px]:grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)_auto]"
        >
          <span className="min-w-0 truncate text-sm" title={item.label}>
            {item.label}
            {item.note && <span className="text-xs text-muted-foreground"> · {item.note}</span>}
          </span>
          <span className="relative col-span-2 row-start-2 h-3 rounded-full bg-canvas group-even:bg-surface min-[641px]:col-span-1 min-[641px]:col-start-2 min-[641px]:row-start-1" aria-hidden="true">
            {zeroBp > 0 && <span className="absolute inset-y-[-3px] w-px bg-line-strong" style={{ left: pct(zeroBp) }} />}
            {item.startBp !== null && item.lengthBp > 0 && (
              <span
                className={cn("absolute inset-y-0 min-w-0.5 rounded-full", item.colorClass)}
                style={{ left: pct(item.startBp), width: pct(item.lengthBp) }}
              />
            )}
          </span>
          <span className="text-right text-sm font-semibold tabular-nums" data-bar-amount>
            {item.amount}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The small colour dot beside a name in a table (always next to its text label). */
export function Dot({ className }: { className: string | null }) {
  return <span aria-hidden="true" className={cn("inline-block size-2.5 shrink-0 rounded-full", className ?? "border border-line-strong")} />
}
