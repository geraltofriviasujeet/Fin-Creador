"use client"

import { createPortal } from "react-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { formatMoney } from "@fin-creador/domain"
import { LINE_SOURCE, PLAN_NOT_LIVE, PLAN_REOPENED, lineWords, planAmount } from "@/lib/ai/plan/format"
import type { CheckedPlan, PlanLine, PlanNames } from "@/lib/ai/plan/types"
import { webPrice } from "@/lib/ai/web-format"

// A detailed plan (10.9), shown in a modal: built only from the checked plan the server
// returned (or stored), the same object the chat answer was written from. A line that couldn't
// be verified says "No estimate" and why; nothing is left out silently. Every web figure and
// name shows the site it was listed on, linked. Save as PDF prints a copy of the same view
// (the browser's print-to-PDF, styled in globals.css), with every link written out, the date
// it was made and where each figure came from; it carries nothing the modal doesn't.

type Props = {
  plan: CheckedPlan
  /** The person's today when the plan was made (YYYY-MM-DD). */
  madeOn: string
  /** Opened from a past conversation: web prices may have changed. */
  reopened: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PlanModal({ plan, madeOn, reopened, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent eyebrow="Roma · Plan" title={plan.intake.title} description={`Made on ${madeOn}.`} className="max-w-3xl md:max-h-[90vh] md:overflow-y-auto">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={saveAsPdf}>
            Save as PDF
          </Button>
          <span className="text-xs text-muted-foreground">Opens your browser’s print window: choose Save as PDF.</span>
        </div>
        <PlanView plan={plan} madeOn={madeOn} reopened={reopened} />
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

/** What the PDF holds: the same view, headed with what it is, when it was made and how to read it. */
function PrintCopy({ plan, madeOn, reopened }: { plan: CheckedPlan; madeOn: string; reopened: boolean }) {
  return (
    <div className="plan-print p-6 text-sm" data-testid="plan-print">
      <p className="text-xs font-semibold uppercase">FinCreador · Roma plan</p>
      <h1 className="font-heading text-2xl font-semibold">{plan.intake.title}</h1>
      <p className="mb-4">
        Made on {madeOn}. Figures marked “From your goal” or under “From your records” come from your own records in FinCreador; figures marked “Web estimate” come from
        the pages linked beside them. These are estimates, not quotes or bookings.
      </p>
      <PlanView plan={plan} madeOn={madeOn} reopened={reopened} />
    </div>
  )
}

const linkClass = "text-ink underline underline-offset-2"
/** A link to a source; printed with its address after it, unless its text is the address. */
const ExternalLink = ({ href, children, isAddress = false }: { href: string; children: React.ReactNode; isAddress?: boolean }) => (
  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={linkClass} {...(isAddress ? {} : { "data-print-url": href })}>
    {children}
  </a>
)

export function PlanView({ plan, madeOn, reopened }: { plan: CheckedPlan; madeOn: string; reopened: boolean }) {
  const { verdicts } = plan
  return (
    <div className="grid gap-5 text-sm" data-testid="plan-view">
      <div className="grid gap-2">
        <p className="rounded-lg bg-chip-blue px-3 py-2 text-ink" role="note">
          {PLAN_NOT_LIVE}
        </p>
        {reopened && (
          <p className="rounded-lg bg-canvas px-3 py-2 text-ink" role="note">
            Made on {madeOn}. {PLAN_REOPENED}
          </p>
        )}
      </div>

      <section aria-label="Verdicts" className="grid gap-3">
        <Verdict heading="From your records" verdict={verdicts.records.verdict} summary={verdicts.records.summary} />
        <Verdict heading="With web estimates, not your records" verdict={verdicts.web.verdict} summary={verdicts.web.summary} dashed />
        {plan.changes.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground">What would make it fit</p>
            <ul className="mt-1 grid list-disc gap-1 pl-5 text-ink">
              {plan.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-label="Cost lines">
        <h3 className="font-heading text-base font-semibold text-ink">Cost lines</h3>
        <ul className="mt-2 grid gap-3">
          {plan.lines.map((l) => (
            <LineRow key={l.line} line={l} />
          ))}
        </ul>
        <div className="mt-3 grid gap-1 border-t border-line pt-3">
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
        </div>
      </section>

      {plan.carriers && <Names heading="Airlines listed for this route" names={plan.carriers} />}
      {plan.hotels && <Names heading="4- and 5-star hotels and resorts listed" names={plan.hotels} />}

      <section aria-label="What the plan is for">
        <h3 className="font-heading text-base font-semibold text-ink">What the plan is for</h3>
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
          <h3 className="font-heading text-base font-semibold text-ink">Assumptions</h3>
          <ul className="mt-2 grid list-disc gap-1 pl-5 text-ink">
            {plan.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Sources">
        <h3 className="font-heading text-base font-semibold text-ink">Sources</h3>
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
  )
}

function Verdict({ heading, verdict, summary, dashed = false }: { heading: string; verdict: string; summary: string; dashed?: boolean }) {
  return (
    <div className={`rounded-lg border border-line px-3 py-2 ${dashed ? "border-dashed" : "border-l-4 border-l-brand-deep"}`}>
      <p className="text-xs font-semibold text-muted-foreground">{heading}</p>
      <p className="font-heading text-lg font-bold text-ink">{verdict}</p>
      <p className="text-ink">{summary}</p>
    </div>
  )
}

const MENTION_WORDS: Partial<Record<PlanLine["line"], string>> = {
  food: "Local dishes mentioned",
  sightseeing: "Places mentioned",
  shopping: "Known for",
}

function LineRow({ line }: { line: PlanLine }) {
  const tone = line.from === "none" ? "neutral" : line.from === "web" ? "info" : "savings"
  return (
    <li className="grid gap-1 rounded-lg border border-line p-3" data-line={line.line}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{lineWords(line.line)}</span>
          <Badge tone={tone}>{LINE_SOURCE[line.from]}</Badge>
        </span>
        <span className="font-semibold text-ink tabular-nums">
          {line.amounts.length > 0 ? line.amounts.map(planAmount).join(" + ") : line.from === "not_estimated" ? "Not estimated" : "No estimate"}
        </span>
      </div>
      <p className="text-muted-foreground">{line.how}</p>
      {line.prices.length > 0 && (
        <ul className="grid gap-0.5">
          {line.prices.map((p, i) => (
            <li key={i} className="text-ink">
              {p.about ? `${p.about}, ` : ""}
              {webPrice(p)}, listed on <ExternalLink href={p.url}>{p.site}</ExternalLink>
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
    </li>
  )
}

function Names({ heading, names }: { heading: string; names: PlanNames }) {
  return (
    <section aria-label={heading}>
      <h3 className="font-heading text-base font-semibold text-ink">{heading}</h3>
      {names.listed.length > 0 && (
        <ul className="mt-2 grid gap-1">
          {names.listed.map((n) => (
            <li key={n.name} className="text-ink">
              <span className="font-semibold">{n.name}</span>
              {n.stars ? ` · ${n.stars}-star` : ""}
              {n.rate ? ` · ${webPrice(n.rate)}` : ""} · listed on <ExternalLink href={n.url}>{n.site}</ExternalLink>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-muted-foreground">{names.note}</p>
    </section>
  )
}

/** The button that opens a plan from its answer. */
export function OpenPlanButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button type="button" variant="brand" onClick={onOpen}>
      Open the plan
    </Button>
  )
}
