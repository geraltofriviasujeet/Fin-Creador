import { type PrivateTerms, type WebLookupInput, buildQuery } from "./query"
import { SearchError, type SearchProvider, type SearchResult } from "./types"

// One question's web lookups (Sprint 10.8). Credits are reserved in the database the first
// time a lookup is about to be sent (roma_search_begin, on the question's own roma_usage
// reservation), never for a lookup refused by the query checks. Begin may grant fewer than 3;
// lookups beyond the grant are refused here. finish() settles the searches sent (a timed-out
// or cut-off one counts as sent) or releases the reservation when none was.

export type SearchBeginOutcome = "ok" | "disabled" | "no_request" | "monthly_cap" | "daily_limit"

export type SearchDb = {
  begin(requestId: string, provider: string): Promise<{ outcome: SearchBeginOutcome; credits: number } | null>
  settle(requestId: string, credits: number): Promise<boolean>
  release(requestId: string): Promise<boolean>
}

/** Why a lookup didn't run, for the model and (the caps) for the person, in code's words. */
export type LookupRefusal = "unlisted_place" | "unlisted_item" | "line_not_for_scope" | "private" | "unsafe" | "off" | "monthly_cap" | "daily_limit" | "question_limit" | "failed" | "timeout"

export type LookupOutcome = { ok: true; subject: string; results: SearchResult[] } | { ok: false; reason: LookupRefusal }

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
}

export class WebSession {
  /** Every result this question's lookups returned: the only sources a web figure may cite. */
  readonly results: SearchResult[] = []
  /** Trip sizes looked up, for totals worked out in code. */
  readonly trips: { nights: number; travellers: number }[] = []
  readonly notices = new Set<string>()
  private grant: Promise<number> | null = null
  private used = 0
  private sent = 0

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
      return { ok: true, subject: built.subject, results }
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

  private async begin(): Promise<number> {
    const { db, requestId, provider } = this.options
    const begun = await db.begin(requestId, provider.name).catch(() => null)
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
