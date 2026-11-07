import { type PrivateTerms, type WebLookupInput, buildQuery } from "./query"
import { SearchError, type SearchProvider, type SearchResult } from "./types"
import { type Bound, type KeptWebFigure, type PriceCandidate, firstPrices, priceCandidates } from "./verify"

// One question's web lookups (Sprint 10.8). Credits are reserved in the database the first
// time a lookup is about to be sent (roma_search_begin, on the question's own roma_usage
// reservation), never for a lookup refused by the query checks. Begin may grant fewer than 3;
// lookups beyond the grant are refused here. finish() settles the searches sent (a timed-out
// or cut-off one counts as sent) or releases the reservation when none was.

export type SearchBeginOutcome = "ok" | "disabled" | "no_request" | "monthly_cap" | "daily_limit"

export type SearchDb = {
  /** `plan`: a 10.9 plan, granted roma_settings.search_plan_reserve_credits instead. */
  begin(requestId: string, provider: string, plan?: boolean): Promise<{ outcome: SearchBeginOutcome; credits: number } | null>
  settle(requestId: string, credits: number): Promise<boolean>
  release(requestId: string): Promise<boolean>
}

/** Why a lookup didn't run, for the model and (the caps) for the person, in code's words. */
export type LookupRefusal = "unlisted_place" | "unlisted_item" | "line_not_for_scope" | "private" | "unsafe" | "off" | "monthly_cap" | "daily_limit" | "question_limit" | "failed" | "timeout"

export type LookupOutcome = { ok: true; subject: string; results: SearchResult[]; prices: (PriceCandidate & { id: string })[] } | { ok: false; reason: LookupRefusal }

/** Prices handed to the model per lookup, found in code. */
const PRICES_PER_LOOKUP = 12

export const WEB_NOTICES: Partial<Record<LookupRefusal, string>> = {
  monthly_cap: "Web lookups are used up for this month (they reset on the 1st). This answer uses your own records only.",
  daily_limit: "You've used today's web lookups. This answer uses your own records only.",
  off: "Web lookups are off right now. This answer uses your own records only.",
  timeout: "A web lookup took too long and was skipped.",
  failed: "A web lookup couldn't be completed and was skipped.",
}

type Options = {
  provider: SearchProvider
  db: SearchDb
  requestId: string
  terms: PrivateTerms
  countryCode: string | null
  /** A 10.9 plan: its larger credit cap is asked for. */
  plan?: boolean
}

/**
 * What became of this question's lookups, in the person's words (10.8): none ran; they ran and
 * prices are shown; or they ran, credits were spent and nothing is shown. Null when none ran.
 */
export function lookupsLine(sent: number, shown: number, reported: { figures: number; dropped: number }): string | null {
  if (sent === 0) return null
  const ran = `${sent} web ${sent === 1 ? "lookup" : "lookups"} ran for this question`
  if (shown > 0) {
    const dropped = reported.dropped > 0 ? ` ${reported.dropped} other ${reported.dropped === 1 ? "price" : "prices"} couldn't be confirmed at the source and ${reported.dropped === 1 ? "isn't" : "aren't"} shown.` : ""
    return `${ran}. Prices confirmed at their source are shown separately as web estimates; they don't change this verdict.${dropped}`
  }
  const why =
    reported.figures > 0
      ? `no price from ${sent === 1 ? "it" : "them"} could be confirmed at its source, so none is shown`
      : `no price from ${sent === 1 ? "it" : "them"} was used, so none is shown`
  return `${ran} and ${sent === 1 ? "counts" : "count"} toward your allowance, but ${why}. This answer uses your own records only.`
}

export class WebSession {
  /** Every result this question's lookups returned: the only sources a web figure may cite. */
  readonly results: SearchResult[] = []
  /** Trip sizes looked up, for totals worked out in code. */
  readonly trips: { nights: number; travellers: number }[] = []
  readonly notices = new Set<string>()
  /** Prices found in code in the results, by id: the only figures the model can pick. */
  readonly candidates = new Map<string, PriceCandidate>()
  /** Figures kept so far this question (every web_price_figures call adds to them). */
  readonly kept: (KeptWebFigure & { id: string; cost_line: string; bound?: Bound; rangeWith?: string })[] = []
  /** Web figures the model reported with web_price_figures, and how many of them were dropped. */
  readonly reported = { figures: 0, dropped: 0 }
  private grant: Promise<number> | null = null
  private used = 0
  private sent = 0

  /** Searches sent for this question (each spends a credit), including timed-out ones. */
  get lookupsSent(): number {
    return this.sent
  }

  constructor(private readonly options: Options) {}

  async lookup(input: WebLookupInput, signal: AbortSignal): Promise<LookupOutcome> {
    const built = buildQuery(input, this.options.terms, this.options.countryCode)
    if (!built.ok) return { ok: false, reason: built.reason }

    // One reservation per question, shared by lookups running in parallel.
    this.grant ??= this.begin()
    const granted = await this.grant
    if (granted <= 0) return this.refuse(this.refusal ?? "off")
    if (this.used >= granted) return { ok: false, reason: "question_limit" }
    this.used++

    try {
      const results = await this.options.provider.search(built.query, signal)
      this.sent++
      for (const r of results) if (!this.results.some((have) => have.url === r.url)) this.results.push(r)
      if (input.kind === "trip") this.trips.push({ nights: input.nights, travellers: input.travellers })
      const prices = firstPrices(results.flatMap((r) => priceCandidates(r)), PRICES_PER_LOOKUP).map((p) => ({ ...p, id: this.idFor(p) }))
      // A range's two ends know each other's id, so keeping one keeps both (web-prices.ts).
      for (const p of prices) {
        if (!p.range) continue
        const other = prices.find((o) => o.source_url === p.source_url && o.currency === p.range!.other.currency && o.amount === p.range!.other.amount && o.scale === p.range!.other.scale)
        if (!other) continue
        p.rangeWith = other.id
        this.candidates.get(p.id)!.rangeWith = other.id
      }
      return { ok: true, subject: built.subject, results, prices }
    } catch (error) {
      if (error instanceof SearchError) {
        if (error.billed === "unknown") this.sent++
        return this.refuse(error.kind === "timeout" ? "timeout" : "failed")
      }
      // Aborted at the deadline: it may have been sent.
      this.sent++
      return this.refuse("timeout")
    }
  }

  /** Settles the searches sent, or releases a reservation none was sent on. Safe to call once a question ends. */
  async finish(): Promise<void> {
    if (!this.grant || (await this.grant) <= 0) return
    const { db, requestId } = this.options
    if (this.sent > 0) await db.settle(requestId, Math.min(this.sent, await this.grant))
    else await db.release(requestId)
  }

  private refusal: LookupRefusal | null = null

  /** One id per price per source for the whole question, so a price found twice keeps its id. */
  private idFor(p: PriceCandidate): string {
    for (const [id, have] of this.candidates) {
      if (have.source_url === p.source_url && have.currency === p.currency && have.amount === p.amount && have.scale === p.scale) return id
    }
    const id = `w${this.candidates.size + 1}`
    this.candidates.set(id, p)
    return id
  }

  private async begin(): Promise<number> {
    const { db, requestId, provider } = this.options
    const begun = await db.begin(requestId, provider.name, this.options.plan).catch(() => null)
    if (!begun || begun.outcome !== "ok") {
      this.refusal = begun?.outcome === "monthly_cap" || begun?.outcome === "daily_limit" ? begun.outcome : "off"
      return 0
    }
    return begun.credits
  }

  private refuse(reason: LookupRefusal): LookupOutcome {
    const notice = WEB_NOTICES[reason]
    if (notice) this.notices.add(notice)
    return { ok: false, reason }
  }
}
