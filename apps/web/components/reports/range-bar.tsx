import Link from "next/link"
import { REPORT_PRESETS, type ReportsRange } from "@fin-creador/api"
import { type IsoDate, MAX_REPORT_MONTHS } from "@fin-creador/domain"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { TextField } from "@/components/ui/field"

// The Reports range (Sprint 8c): 3, 6, 12 or 24 whole months ending this month, or custom
// months. Plain links and a GET form, so the range lives in the URL and works without JavaScript.

export const REPORTS_PATH = "/reports"

export const REPORTS_HEADER = {
  eyebrow: "Look back",
  title: "Reports",
  description: "Month by month: what came in, what went out and how your net worth moved. Download your entries as CSV.",
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "Oct 2026" for a month start. */
export function monthLabel(month: IsoDate): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
}

const pill = (active: boolean) =>
  cn(
    "flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground transition-colors motion-reduce:transition-none md:px-4",
    "hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-deep",
    active && "bg-surface text-ink shadow-sm"
  )

export function RangeBar({ range, today, custom }: { range: ReportsRange; today: IsoDate; custom: boolean }) {
  return (
    <div className="mb-4 grid gap-3">
      <nav aria-label="Range">
        <ul className="flex w-fit flex-wrap rounded-xl bg-line/60 p-1">
          {REPORT_PRESETS.map((n) => (
            <li key={n}>
              <Link href={`${REPORTS_PATH}?months=${n}`} scroll={false} aria-current={!custom && range.preset === n ? "page" : undefined} className={pill(!custom && range.preset === n)}>
                {n} months
              </Link>
            </li>
          ))}
          <li>
            <Link
              href={`${REPORTS_PATH}?range=custom&from=${range.from.slice(0, 7)}&to=${range.to.slice(0, 7)}`}
              scroll={false}
              aria-current={custom ? "page" : undefined}
              className={pill(custom)}
            >
              Custom
            </Link>
          </li>
        </ul>
      </nav>
      {custom && (
        <Card>
          <form action={REPORTS_PATH} method="get" className="grid items-end gap-4 md:grid-cols-[1fr_1fr_auto]">
            <input type="hidden" name="range" value="custom" />
            {/* type=month falls back to text where unsupported; the pattern keeps it YYYY-MM. */}
            <TextField name="from" type="month" label="From month" pattern="\d{4}-\d{2}" placeholder="2026-01" max={today.slice(0, 7)} defaultValue={range.from.slice(0, 7)} required />
            <TextField name="to" type="month" label="To month" pattern="\d{4}-\d{2}" placeholder="2026-10" max={today.slice(0, 7)} defaultValue={range.to.slice(0, 7)} required />
            <Button type="submit">Show months</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">At most {MAX_REPORT_MONTHS} months, up to this month.</p>
        </Card>
      )}
    </div>
  )
}
