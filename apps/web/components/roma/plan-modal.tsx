"use client"

import { useState } from "react"
import Link from "next/link"
import { createPortal } from "react-dom"
import { ChevronDown, ChevronRight, type LucideIcon, Send, Sparkles, Target, Wallet } from "lucide-react"
import { GoalForm } from "@/components/goals/goal-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { formatMoney } from "@fin-creador/domain"
import type { PlanLink } from "@/lib/ai/handle"
import {
  LINE_SOURCE,
  PLAN_NOT_LIVE,
  PLAN_REOPENED,
  STATUS_WORDS,
  changeParts,
  lineCaption,
  lineWords,
  planAmount,
  planHeading,
  planPrice,
  planVerdictCard,
  shortMonth,
  totalFigure,
} from "@/lib/ai/plan/format"
import { goalFromPlan } from "@/lib/ai/plan/goal"
import type { CheckedPlan, PlanLine, PlanNames, PlanSignal } from "@/lib/ai/plan/types"

// A detailed plan (10.9), shown in a modal (layout from docs/design/roma, 2026-11-09): built only from the checked plan the server
// returned (or stored), the same object the chat answer was written from. A line that couldn't
// be verified says "No estimate" and why; nothing is left out silently. Every web figure and
// name shows the site it was listed on, linked. Save as PDF prints a copy of the same view
// (the browser's print-to-PDF, styled in globals.css), with every link written out, the date
// it was made and where each figure came from; it carries nothing the modal doesn't.
// "Create travel goal" ("Create goal" for a purchase) shows the normal goal form, prefilled from the plan (lib/ai/plan/goal.ts);
// nothing is saved until the person adds it there, and the goal then links to the plan's turn.

type Props = {
  plan: CheckedPlan
  /** The person's today when the plan was made (YYYY-MM-DD). */
  madeOn: string
  /** Opened from a past conversation: web prices may have changed. */
  reopened: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The plan's stored turn and its goal; absent when the plan couldn't be saved (it can't be added as a goal). */
  link?: PlanLink
  /** The profile currency and the person's today, for the goal form. */
  currency: string
  today: string
}

export function PlanModal({ plan, madeOn, reopened, open, onOpenChange, link, currency, today }: Props) {
  const [view, setView] = useState<"plan" | "goal">("plan")
  const [goal, setGoal] = useState(link?.goal ?? null)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const linked = goal ?? link?.goal ?? null
  const heading = planHeading(plan, madeOn)
  const createWords = plan.kind === "trip" ? "Create travel goal" : "Create goal"
  const change = (next: boolean) => {
    if (!next) {
      setView("plan")
      setSourcesOpen(false)
    }
    onOpenChange(next)
  }
  const showSources = () => {
    setSourcesOpen(true)
    // After the section renders open.
    requestAnimationFrame(() => document.getElementById(SOURCES_ID)?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        eyebrow={view === "goal" ? `${heading.eyebrow} · Add to my goals` : heading.eyebrow}
        title={heading.title}
        description={heading.subline}
        actions={
          view === "plan" && (
            <Button type="button" variant="secondary" onClick={saveAsPdf}>
              Save as PDF
            </Button>
          )
        }
        className="max-w-4xl md:max-h-[90vh] md:overflow-y-auto md:pb-0"
      >
        {view === "goal" && link ? (
          <div className="md:pb-6">
            <AddGoal plan={plan} link={link} currency={currency} today={today} onSaved={setGoal} onClose={() => setView("plan")} />
          </div>
        ) : (
          <>
            {linked && (
              <p className="mb-4 rounded-lg bg-canvas px-3 py-2 text-sm text-ink" role="status" data-testid="plan-goal">
                Added to your goals as “{linked.name}”. Roma reads it like any other goal.{" "}
                <Link href="/goals" className={linkClass}>
                  Open Goals
                </Link>
              </p>
            )}
            <PlanView plan={plan} madeOn={madeOn} reopened={reopened} sourcesOpen={sourcesOpen} onSourcesOpenChange={setSourcesOpen} />
            <div className="sticky bottom-0 z-10 -mx-5 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3 md:-mx-6 md:px-6 md:py-4">
              <button type="button" onClick={showSources} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-deep underline-offset-2 hover:underline">
                View data sources <ChevronRight aria-hidden="true" className="size-4" />
              </button>
              <div className="flex flex-wrap items-center gap-2">
                {!link && <span className="text-xs text-muted-foreground">Not saved, so it can’t be added to your goals. Ask again to make it once more.</span>}
                <DialogClose render={<Button type="button" variant="secondary" />}>Close</DialogClose>
                {link && !linked && (
                  <Button type="button" variant="primary" onClick={() => setView("goal")}>
                    {createWords}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
      {open && typeof document !== "undefined" && createPortal(<PrintCopy plan={plan} madeOn={madeOn} reopened={reopened} />, document.body)}
    </Dialog>
  )
}

/** Prints the plan's copy alone; the page comes back as it was after the print window closes. */
function saveAsPdf() {
  document.body.classList.add("printing-plan")
  window.addEventListener("afterprint", () => document.body.classList.remove("printing-plan"), { once: true })
  window.print()
}

/** What the PDF holds: the same heading and view, every section open, and how to read it. */
function PrintCopy({ plan, madeOn, reopened }: { plan: CheckedPlan; madeOn: string; reopened: boolean }) {
  const heading = planHeading(plan, madeOn)
  return (
    <div className="plan-print p-6 text-sm" data-testid="plan-print">
      <p className="text-xs font-semibold tracking-(--fc-tracking-eyebrow) uppercase">FinCreador · {heading.eyebrow}</p>
      <h1 className="font-heading text-2xl font-semibold">{heading.title}</h1>
      <p className="mb-2">{heading.subline}</p>
      <p className="mb-4">
        Made on {madeOn}. Figures marked “From your records” come from your own records in FinCreador; figures marked “Web estimate” come from the pages linked
        beside them; “Calculated” ones are worked out by the app from the other lines. These are estimates, not quotes or bookings.
      </p>
      <PlanView plan={plan} madeOn={madeOn} reopened={reopened} expandAll />
    </div>
  )
}

const SOURCES_ID = "plan-sources"
const linkClass = "text-ink underline underline-offset-2"
/** A link to a source; printed with its address after it, unless its text is the address. */
const ExternalLink = ({ href, children, isAddress = false }: { href: string; children: React.ReactNode; isAddress?: boolean }) => (
  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={linkClass} {...(isAddress ? {} : { "data-print-url": href })}>
    {children}
  </a>
)

type ViewProps = {
  plan: CheckedPlan
  madeOn: string
  reopened: boolean
  /** The PDF: every row and section open. */
  expandAll?: boolean
  sourcesOpen?: boolean
  onSourcesOpenChange?: (open: boolean) => void
}

/**
 * The plan, top to bottom: the verdict card (the records-only verdict first, then Roma's verdict
 * in plain words), three figures, ways to make it fit, the cost breakdown (each line opens to its
 * prices and pages), then the data sources. Every figure is the checked plan's own.
 */
export function PlanView({ plan, madeOn, reopened, expandAll = false, sourcesOpen = false, onSourcesOpenChange }: ViewProps) {
  const [ownSourcesOpen, setOwnSourcesOpen] = useState(false)
  const showSources = expandAll || (onSourcesOpenChange ? sourcesOpen : ownSourcesOpen)
  const toggleSources = () => (onSourcesOpenChange ?? setOwnSourcesOpen)(!showSources)
  const { verdicts } = plan
  return (
    <div className="grid gap-4 text-sm" data-testid="plan-view">
      {reopened && (
        <p className="rounded-lg bg-canvas px-3 py-2 text-ink" role="note">
          Made on {madeOn}. {PLAN_REOPENED}
        </p>
      )}

      <VerdictCard plan={plan} expandAll={expandAll} />
      <StatCards plan={plan} />

      {plan.changes.length > 0 && (
        <Panel icon={Sparkles} title="Ways to make it fit" subtitle="Adjust one or combine several options." label="Ways to make it fit">
          <ol className="grid gap-3 md:grid-cols-3">
            {plan.changes.map((c, i) => {
              const { title, detail } = changeParts(c)
              return (
                <li key={title} className="flex items-start gap-3 rounded-xl border border-line p-3">
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-chip-mint text-xs font-semibold text-ink tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="grid gap-0.5">
                    <span className="font-semibold text-ink">{title}</span>
                    {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
                  </span>
                </li>
              )
            })}
          </ol>
        </Panel>
      )}

      <Panel
        icon={Wallet}
        title="Cost breakdown"
        subtitle="Estimates are clearly separated from your own records."
        label="Cost breakdown"
        aside={verdicts.totals.length > 0 && <span className="font-heading text-base font-semibold text-ink tabular-nums">{verdicts.totals.map(planAmount).join(" + ")} total</span>}
      >
        <ul className="grid divide-y divide-line border-t border-line">
          {plan.lines.map((l) => (
            <LineRow key={l.line} line={l} plan={plan} expandAll={expandAll} />
          ))}
        </ul>
        <div className="grid gap-1 border-t border-line pt-3">
          {verdicts.totals.length === 0 ? (
            <p className="text-ink">
              <span className="font-semibold">Total:</span> no estimate. No line could be priced.
            </p>
          ) : (
            verdicts.totals.map((t) => (
              <p key={t.currency} className="flex flex-wrap justify-between gap-x-4 text-ink">
                <span className="font-semibold">Total{verdicts.totals.length > 1 ? `, in ${t.currency}` : ""}, lines with an estimate only</span>
                <span className="font-semibold tabular-nums">{planAmount(t)}</span>
              </p>
            ))
          )}
          {plan.saved && (
            <p className="flex flex-wrap justify-between gap-x-4 text-ink">
              <span>Already saved toward {plan.saved.goal} (your records)</span>
              <span className="tabular-nums">{formatMoney(plan.saved.minor, { currency: plan.saved.currency })}</span>
            </p>
          )}
          <p className="mt-2 rounded-lg bg-chip-blue px-3 py-2 text-ink" role="note">
            {PLAN_NOT_LIVE}
          </p>
        </div>
      </Panel>

      <section id={SOURCES_ID} aria-label="Data sources" className="scroll-mt-4 rounded-2xl border border-line">
        <h3>
          <button
            type="button"
            aria-expanded={showSources}
            aria-controls={`${SOURCES_ID}-body`}
            onClick={toggleSources}
            className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left font-heading text-base font-semibold text-ink hover:bg-canvas"
          >
            Data sources and assumptions
            <ChevronDown aria-hidden="true" className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${showSources ? "rotate-180" : ""}`} />
          </button>
        </h3>
        {showSources && (
          <div id={`${SOURCES_ID}-body`} className="grid gap-5 border-t border-line px-4 py-4">
            <section aria-label="What the plan is for">
              <h4 className="font-semibold text-ink">What the plan is for</h4>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {plan.intake.fields.map((f) => (
                  <div key={f.label} className="contents">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd className="text-ink">{f.value ?? "Skipped"}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {plan.assumptions.length > 0 && (
              <section aria-label="Assumptions">
                <h4 className="font-semibold text-ink">Assumptions</h4>
                <ul className="mt-2 grid list-disc gap-1 pl-5 text-ink">
                  {plan.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </section>
            )}
            <section aria-label="Sources">
              <h4 className="font-semibold text-ink">Sources</h4>
              {plan.sources.length === 0 ? (
                <p className="mt-1 text-muted-foreground">No web pages were used.</p>
              ) : (
                <ol className="mt-2 grid list-decimal gap-1 pl-5 break-all text-ink">
                  {plan.sources.map((s) => (
                    <li key={s.url}>
                      {s.site}:{" "}
                      <ExternalLink href={s.url} isAddress>
                        {s.url}
                      </ExternalLink>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  )
}

/** A white card with an icon tile, a title and a one-line subtitle (the design's section card). */
function Panel({ icon: Icon, title, subtitle, label, aside, children }: { icon: LucideIcon; title: string; subtitle: string; label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="grid gap-4 rounded-2xl border border-line p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-chip-mint text-ink">
            <Icon className="size-5" />
          </span>
          <div>
            <h3 className="font-heading text-base font-semibold text-ink">{title}</h3>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

const SIGNAL_WORDS = { yes: "Holds", no: "Doesn't hold", unknown: "Can't say" } as const

/**
 * One dark card: the records-only verdict first (rule 3: never changed by web figures), then
 * Roma's verdict in plain words with its reason and status. "How Roma decided" opens the
 * signals and the verdict with web estimates, each marked as not from the records.
 */
function VerdictCard({ plan, expandAll }: { plan: CheckedPlan; expandAll: boolean }) {
  const [open, setOpen] = useState(false)
  const shown = expandAll || open
  const { records, web, both } = plan.verdicts
  const card = planVerdictCard(plan)
  const Icon = plan.kind === "trip" ? Send : Target
  return (
    <section aria-label="Roma's verdict" className="on-dark grid gap-3 rounded-2xl bg-brand-deep p-4 text-nav-text md:p-5 print:border print:border-line print:bg-transparent print:text-ink">
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className="hidden size-12 shrink-0 place-items-center rounded-xl bg-brand text-ink md:grid">
          <Icon className="size-6" />
        </span>
        <div className="grid min-w-0 flex-1 gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold tracking-(--fc-tracking-eyebrow) text-brand uppercase print:text-ink">Roma’s verdict</p>
            <Badge tone="onDark" data-testid="plan-status" className="print:text-ink">
              {STATUS_WORDS[card.status]}
            </Badge>
          </div>
          <p>
            <span className="font-semibold">From your records:</span> {records.summary.startsWith(records.verdict) ? records.summary : `${records.verdict} ${records.summary}`}
          </p>
          <p className="font-heading text-xl font-semibold text-white print:text-ink">{card.headline}</p>
          <p>{card.reason}</p>
          <div>
            <button
              type="button"
              aria-expanded={shown}
              onClick={() => setOpen(!open)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand underline-offset-2 hover:underline print:hidden"
            >
              How Roma decided <ChevronDown aria-hidden="true" className={`size-4 transition-transform motion-reduce:transition-none ${shown ? "rotate-180" : ""}`} />
            </button>
            {shown && (
              <dl className="mt-2 grid gap-2 border-t border-white/15 pt-2 print:border-line">
                {both && (
                  <>
                    <Signal label="Free money by the travel month" signal={both.money} />
                    <Signal label="Against your past trip" signal={both.past} />
                  </>
                )}
                <div>
                  <dt className="font-semibold">With web estimates, not your records</dt>
                  <dd>{web.summary}</dd>
                </div>
              </dl>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function Signal({ label, signal }: { label: string; signal: PlanSignal }) {
  return (
    <div>
      <dt className="flex flex-wrap items-center gap-2 font-semibold">
        <span>{label}</span> <Badge tone="onDark" className="print:text-ink">{SIGNAL_WORDS[signal.met]}</Badge>
      </dt>
      <dd>{signal.summary}</dd>
    </div>
  )
}

/** Estimated cost, free money by the month, extra saving needed: the projection's own figures, or why there is none. */
function StatCards({ plan }: { plan: CheckedPlan }) {
  const { totals, figures } = plan.verdicts
  const priced = plan.lines.filter((l) => l.from !== "not_estimated")
  const missing = priced.filter((l) => l.from === "none").length
  const web = plan.lines.some((l) => l.from === "web")
  const total = totals.length === 1 ? totalFigure(totals[0]!, web) : totals.length > 1 ? { value: totals.map(planAmount).join(" + "), caption: "In more than one currency" } : null
  const money = (minor: number) => formatMoney(minor, { currency: figures!.currency })
  const noFigure = figures ? (figures.month === null ? "The month was skipped" : "Not enough in your records to say") : "Not worked out for this plan"
  const free = figures?.freeMinor ?? null
  const extra = figures?.extraMonthlyMinor ?? null
  return (
    <section aria-label="Plan figures" className="grid gap-3 md:grid-cols-3">
      <Stat
        label={plan.kind === "trip" ? "Estimated trip cost" : "Estimated cost"}
        value={total?.value ?? "No estimate"}
        caption={total ? `${total.caption}${missing > 0 ? ` · ${missing} ${missing === 1 ? "line has" : "lines have"} none` : ""}` : "No line could be priced"}
      />
      <Stat
        label={figures?.month ? `Free money by ${shortMonth(figures.month)}` : "Free money by the month"}
        value={free === null ? "No figure" : money(free)}
        negative={free !== null && free < 0}
        caption={free === null ? noFigure : "After your other goals"}
      />
      <Stat
        label="Extra saving needed"
        value={extra === null ? "No figure" : extra === 0 ? "None" : money(extra)}
        caption={extra === null ? noFigure : extra === 0 ? "It fits at your current rate" : `More a month${figures?.month ? `, to have it by ${shortMonth(figures.month)}` : ""}`}
      />
    </section>
  )
}

function Stat({ label, value, caption, negative = false }: { label: string; value: string; caption: string; negative?: boolean }) {
  return (
    <div className="grid gap-1 rounded-2xl border border-line p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-heading text-xl font-semibold tabular-nums ${negative ? "text-danger" : "text-ink"}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  )
}

const MENTION_WORDS: Partial<Record<PlanLine["line"], string>> = {
  food: "Local dishes mentioned",
  stay: "Also listed, no rate found",
  sightseeing: "Places mentioned",
  shopping: "Known for",
}

const SOURCE_TONE: Record<PlanLine["from"], "info" | "savings" | "neutral" | "positive"> = {
  web: "info",
  goal: "positive",
  worked_out: "savings",
  none: "neutral",
  not_estimated: "neutral",
}

/** One cost line: its name, sub-label, source, amount; it opens to how it was worked out, its prices with their subjects and links, and its pages. A line with no estimate says why without opening. */
function LineRow({ line, plan, expandAll }: { line: PlanLine; plan: CheckedPlan; expandAll: boolean }) {
  const [open, setOpen] = useState(false)
  const shown = expandAll || open
  const id = `plan-line-${line.line}`
  const caption = lineCaption(line, plan)
  const unpriced = line.from === "none" || line.from === "not_estimated"
  const names = line.line === "transport" ? plan.carriers && { heading: "Airlines listed for this route", names: plan.carriers } : line.line === "stay" ? plan.hotels && { heading: "4- and 5-star hotels and resorts listed", names: plan.hotels } : null
  return (
    <li data-line={line.line}>
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-3 text-left hover:bg-canvas/60 md:grid-cols-[1fr_auto_auto_auto]"
      >
        <span className="grid min-w-0 gap-0.5">
          <span className="font-semibold text-ink">{lineWords(line.line)}</span>
          {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
        </span>
        <span className="col-start-1 row-start-2 md:col-start-auto md:row-start-auto">
          <Badge tone={SOURCE_TONE[line.from]}>{LINE_SOURCE[line.from]}</Badge>
        </span>
        <span className="col-start-2 row-start-1 text-right font-semibold text-ink tabular-nums md:col-start-auto md:row-start-auto">
          {line.amounts.length > 0 ? line.amounts.map(planAmount).join(" + ") : line.from === "not_estimated" ? "Not estimated" : "No estimate"}
        </span>
        <ChevronDown aria-hidden="true" className={`col-start-2 row-start-2 size-4 justify-self-end text-muted-foreground transition-transform motion-reduce:transition-none md:col-start-auto md:row-start-auto print:hidden ${shown ? "rotate-180" : ""}`} />
      </button>
      {unpriced && !shown && <p className="-mt-1 pb-3 text-muted-foreground">{line.how}</p>}
      {shown && (
        <div id={id} className="grid gap-1 pb-3">
          <p className="text-muted-foreground">{line.how}</p>
          {line.prices.length > 0 && (
            <ul className="grid gap-0.5">
              {line.prices.map((p, i) => (
                <li key={i} className="text-ink">
                  {p.about ? `${p.about}, ` : ""}
                  {planPrice(p)}, listed on <ExternalLink href={p.url}>{p.site}</ExternalLink>
                </li>
              ))}
            </ul>
          )}
          {line.mentions && line.mentions.length > 0 && (
            <p className="text-ink">
              <span className="text-muted-foreground">{MENTION_WORDS[line.line] ?? "Mentioned"}: </span>
              {line.mentions.map((m, i) => (
                <span key={m.name}>
                  {i > 0 ? "; " : ""}
                  {m.name} (<ExternalLink href={m.url}>{m.site}</ExternalLink>)
                </span>
              ))}
            </p>
          )}
          {line.pages.length > 0 && (
            <p className="text-muted-foreground">
              Pages found:{" "}
              {line.pages.map((p, i) => (
                <span key={p.url}>
                  {i > 0 ? ", " : ""}
                  <ExternalLink href={p.url}>{p.site}</ExternalLink>
                </span>
              ))}
            </p>
          )}
          {names && <Names heading={names.heading} names={names.names} />}
        </div>
      )}
    </li>
  )
}

function Names({ heading, names }: { heading: string; names: PlanNames }) {
  return (
    <section aria-label={heading} className="mt-1">
      <h4 className="font-semibold text-ink">{heading}</h4>
      {names.listed.length > 0 && (
        <ul className="mt-1 grid gap-1">
          {names.listed.map((n) => (
            <li key={n.name} className="text-ink">
              <span className="font-semibold">{n.name}</span>
              {n.stars ? ` · ${n.stars}-star` : ""}
              {n.rate ? ` · ${planPrice(n.rate)}` : ""} · listed on <ExternalLink href={n.url}>{n.site}</ExternalLink>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-muted-foreground">{names.note}</p>
    </section>
  )
}

/** The normal goal form, prefilled from the plan; the person adds it, or goes back to the plan. */
function AddGoal({ plan, link, currency, today, onSaved, onClose }: { plan: CheckedPlan; link: PlanLink; currency: string; today: string; onSaved: (g: { id: string; name: string }) => void; onClose: () => void }) {
  const [prefill] = useState(() => goalFromPlan(plan, { currency, today }))
  return (
    <div className="grid gap-4">
      <div className="grid gap-2 text-sm">
        <p className="text-ink">Filled in from the plan. Check each answer and change anything you like: nothing is added until you press Add goal.</p>
        {prefill.notes.length > 0 && (
          <ul className="grid list-disc gap-1 pl-5 text-muted-foreground">
            {prefill.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
      <GoalForm currency={currency} today={today} initial={prefill.values} planMessageId={link.messageId} onSaved={onSaved} onDone={onClose} onCancel={onClose} />
    </div>
  )
}

/**
 * A plan's answer in the chat (2026-11-09): its status, the headline, the estimated cost and how
 * many lines have an estimate, and the button that opens it. The detail is only in the modal.
 */
export function PlanSummary({ plan, onOpen }: { plan: CheckedPlan; onOpen: () => void }) {
  const card = planVerdictCard(plan)
  const priced = plan.lines.filter((l) => l.from !== "not_estimated")
  const estimated = priced.filter((l) => l.from !== "none").length
  const web = plan.lines.some((l) => l.from === "web")
  const totals = plan.verdicts.totals
  const total = totals.length === 1 ? totalFigure(totals[0]!, web) : totals.length > 1 ? { value: totals.map(planAmount).join(" + "), caption: "In more than one currency" } : null
  const Icon = plan.kind === "trip" ? Send : Target
  return (
    <section aria-label="Plan summary" className="grid gap-4 rounded-2xl border border-line p-4" data-testid="plan-summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-ink">
            <Icon className="size-5" />
          </span>
          <div className="grid min-w-0 gap-0.5">
            <p className="text-xs font-semibold tracking-(--fc-tracking-eyebrow) text-muted-foreground uppercase">{plan.kind === "trip" ? "Travel plan" : "Purchase plan"}</p>
            <p className="font-heading text-lg font-semibold text-ink">{card.headline}</p>
          </div>
        </div>
        <Badge tone={card.status === "fits" ? "positive" : card.status === "adjust" ? "negative" : "neutral"} data-testid="plan-summary-status">
          {STATUS_WORDS[card.status]}
        </Badge>
      </div>
      <dl className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-line p-3">
          <dt className="text-xs text-muted-foreground">Estimated cost</dt>
          <dd className="font-heading text-xl font-semibold text-ink tabular-nums">{total?.value ?? "No estimate"}</dd>
          <dd className="text-xs text-muted-foreground">{total?.caption ?? "No line could be priced"}</dd>
        </div>
        <div className="rounded-xl border border-line p-3">
          <dt className="text-xs text-muted-foreground">Cost lines with an estimate</dt>
          <dd className="font-heading text-xl font-semibold text-ink tabular-nums">
            {estimated} of {priced.length}
          </dd>
          <dd className="text-xs text-muted-foreground">{estimated < priced.length ? "The plan says why for the others" : "Every line has one"}</dd>
        </div>
      </dl>
      <Button type="button" variant="primary" className="justify-self-start" onClick={onOpen}>
        Open the plan
      </Button>
    </section>
  )
}
