import Link from "next/link"
import { CalendarClock, ChevronRight, CircleAlert, CreditCard, FileText, HandCoins, Landmark, type LucideIcon } from "lucide-react"
import { type HomeBill, type HomeData, UPCOMING_DAYS, billDisplayMinor, heroText, shortWarnings } from "@fin-creador/api"
import { formatDayMonth, formatMoneyWhole } from "@fin-creador/domain"
import { Badge } from "@/components/ui/badge"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"

// Safe to spend and Coming up on the web Overview (Sprint 13a PR 5). Every figure and every
// sentence comes from packages/api (buildHome, heroText, shortWarnings), the same as the
// phone's Home, so both clients always show the same numbers. Nothing is calculated here.

/** Whole units, as on the phone's Home. */
const whole = (minor: number, currency: string) => formatMoneyWhole(minor, { currency })
/** U+2212, as the phone shows money out. */
const MINUS = "−"

/** Where "Set your income date" goes: a recurring income is the date Safe to spend counts to. */
export const INCOME_DATE_HREF = "/recurring"

export function SafeToSpendCard({ home }: { home: HomeData }) {
  const hero = heroText(home)
  const { currency } = home
  return (
    <Card tone="deep" aria-labelledby="safe-title" className="mb-4 grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-center">
      <div className="grid min-w-0 gap-2">
        <h2 id="safe-title" className="text-sm text-nav-text">
          {hero.title}
        </h2>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-heading text-4xl font-semibold tracking-(--fc-tracking-heading) tabular-nums md:text-5xl">{whole(hero.amountMinor, currency)}</span>
          {hero.suffix && <span className="text-base text-nav-text">{hero.suffix}</span>}
        </p>
        {hero.lines.map((line, i) =>
          hero.short && i === 0 ? (
            // The shortfall reads as a problem: warning colour and icon (never lime, which reads as good).
            <p key={line} className="flex items-start gap-2 text-sm font-semibold text-warning-on-dark">
              <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
              <span>
                <span className="sr-only">Warning: </span>
                {line}
              </span>
            </p>
          ) : (
            <p key={line} className="text-sm font-semibold text-nav-text">
              {line}
            </p>
          ),
        )}
        {hero.spentBar && (
          <div className="mt-1 grid max-w-md gap-1.5">
            <div
              role="progressbar"
              aria-label={hero.spentBar.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(hero.spentBar.value, 1) * 100)}
              className="h-2 overflow-hidden rounded-full bg-white/10"
            >
              <span className="block h-2 rounded-full bg-brand" style={{ width: `${Math.min(hero.spentBar.value, 1) * 100}%` }} />
            </div>
            <p className="text-xs text-nav-text">{hero.spentBar.label}</p>
          </div>
        )}
        {hero.needsIncomeDate && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-nav-text">
            Set the date your income arrives to see a daily figure.
            <Link
              href={INCOME_DATE_HREF}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-white/10 px-3 font-semibold text-nav-text underline-offset-4 hover:underline md:min-h-9"
            >
              <CalendarClock aria-hidden="true" className="size-4 text-brand" />
              Set your income date
            </Link>
          </p>
        )}
      </div>
      <dl className="grid grid-cols-3 gap-3 border-t border-white/10 pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
        {hero.figures.map((f) => (
          <div key={f.label} className="grid min-w-0 gap-1">
            <dt className="text-xs text-nav-text">{f.label}</dt>
            <dd className="truncate font-heading text-lg font-semibold tabular-nums">{whole(f.minor, currency)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

/** When the figures couldn't load: never a partial Safe to spend. */
export function SafeToSpendUnavailable() {
  return (
    <Card aria-labelledby="safe-title" className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="safe-title" className="text-sm font-semibold">
          Safe to spend
        </h2>
        <p className="text-sm text-muted-foreground">We couldn’t work out Safe to spend just now.</p>
      </div>
      <Link href="/" className="text-sm font-semibold underline underline-offset-4">
        Try again
      </Link>
    </Card>
  )
}

const BILL_ICONS: Record<HomeBill["kind"], LucideIcon> = { bill: CalendarClock, emi: Landmark, card: CreditCard, borrowing: HandCoins, statutory: FileText }

/** The bills Safe to spend counts: overdue first (labelled), then the next 30 days, as on the phone. */
export function ComingUpCard({ home }: { home: HomeData }) {
  const warnings = shortWarnings(home)
  return (
    <Card aria-labelledby="coming-up-title" className="px-0 md:px-0">
      <div className="flex items-start justify-between gap-3 px-5 md:px-6">
        <div>
          <CardTitle id="coming-up-title">Coming up</CardTitle>
          <CardDescription className="mt-1">Bills, EMIs and card dues in Safe to spend</CardDescription>
        </div>
        <Link
          href="/recurring"
          aria-label="See all bills that repeat"
          className="flex min-h-[44px] shrink-0 items-center gap-1 text-sm font-semibold text-success underline-offset-4 hover:underline md:min-h-10"
        >
          See all
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      {warnings.length > 0 && (
        <ul className="mt-3 grid gap-2 px-5 md:px-6">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 rounded-xl bg-chip-peach px-3 py-2.5 text-sm text-danger">
              <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
              <span>
                <span className="sr-only">Warning: </span>
                {w}
              </span>
            </li>
          ))}
        </ul>
      )}
      {home.comingUp.length === 0 ? (
        <p className="px-5 pt-4 pb-1 text-sm text-muted-foreground md:px-6">No bills, EMIs or card dues in the next {UPCOMING_DAYS} days.</p>
      ) : (
        <ul aria-label="Bills coming up" className="mt-4 border-t border-line">
          {home.comingUp.map((b) => {
            const Icon = BILL_ICONS[b.kind]
            return (
              <li key={b.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0 md:gap-4 md:px-6">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-chip-peach text-ink">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                    <span className="truncate">{b.name}</span>
                    {b.overdue && <Badge tone="negative">Overdue</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDayMonth(b.dueDate)} · {b.accountName ?? "No account set"}
                  </p>
                </div>
                <p className="shrink-0 text-right text-sm font-semibold tabular-nums">
                  <span className="sr-only">Money out, </span>
                  <span aria-hidden="true">{MINUS}</span>
                  {whole(billDisplayMinor(b), b.currency)}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      {home.comingUpMore > 0 && (
        <p className="px-5 pt-3 text-xs text-muted-foreground md:px-6">
          {home.comingUpMore} more in the next {UPCOMING_DAYS} days
        </p>
      )}
    </Card>
  )
}
