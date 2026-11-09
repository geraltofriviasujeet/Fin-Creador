import { z } from "zod"
import { PURCHASE_USES, TRIP_STYLES } from "../search/query"

// Detailed plans (Sprint 10.9). A plan request comes from the intake, built in code: every
// field is null when the person skipped it, and a skipped field makes the lines that need it
// "no estimate"; the plan still runs. The checked plan is built in code from the person's
// records, their goals and web prices the model picked by id: the chat answer, the modal, the
// PDF and the stored copy (ai_messages.plan, checked by the database) are all this one object.
// It holds no account names or numbers and no balance: only the amount already saved toward
// a matching goal.

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

export const tripPlanRequest = z
  .object({
    kind: z.literal("trip"),
    destination: z.string().trim().min(1).max(40).nullable(),
    /** Where they travel from: the flight and carrier lookups need it; skipped, transport is no estimate. */
    origin: z.string().trim().min(1).max(40).nullable(),
    month: month.nullable(),
    nights: z.number().int().min(1).max(30).nullable(),
    travellers: z.number().int().min(1).max(9).nullable(),
    style: z.enum(TRIP_STYLES).nullable(),
    /** Made from the records only, by choice at the intake (lookups used up): no web lookups run. */
    recordsOnly: z.literal(true).optional(),
  })
  .strict()

export const PURCHASE_ITEMS = ["bike", "car", "house"] as const

export const purchasePlanRequest = z
  .object({
    kind: z.literal("purchase"),
    item: z.enum(PURCHASE_ITEMS),
    /** A vehicle's make and model, from the app's list. A house has neither. */
    make: z.string().trim().min(1).max(40).nullable(),
    model: z.string().trim().min(1).max(40).nullable(),
    month: month.nullable(),
    /** Trade-in or deposit already arranged, in the profile currency's minor units. */
    depositMinor: z.number().int().min(0).max(1e13).nullable(),
    /** A shortlist (a bike or car with no make): its main use, and the budget in the profile currency's minor units (null: worked out from the records). Absent on plans made before shortlists. */
    use: z.enum(PURCHASE_USES).nullable().optional(),
    budgetMinor: z.number().int().min(0).max(1e13).nullable().optional(),
    /** As a trip's: made from the records only, by choice at the intake. */
    recordsOnly: z.literal(true).optional(),
  })
  .strict()

export const planRequest = z.discriminatedUnion("kind", [tripPlanRequest, purchasePlanRequest])
export type PlanRequest = z.infer<typeof planRequest>
export type TripPlanRequest = z.infer<typeof tripPlanRequest>
export type PurchasePlanRequest = z.infer<typeof purchasePlanRequest>

export const TRIP_PLAN_LINES = ["transport", "stay", "food", "local_travel", "sightseeing", "shopping", "buffer"] as const
export const PURCHASE_PLAN_LINES = ["price", "extras"] as const
export const PLAN_LINES = [...TRIP_PLAN_LINES, ...PURCHASE_PLAN_LINES] as const
export type PlanLineName = (typeof PLAN_LINES)[number]

const decimal = z.string().regex(/^\d{1,15}(\.\d{1,6})?$/)
const url = z.string().max(500).regex(/^https:\/\//)
const site = z.string().min(1).max(120)
const text = (max: number) => z.string().max(max)
const bound = z.enum(["at_least", "at_most", "mixed"])

/**
 * An amount in one currency: one figure, or low to high; a minimum or maximum when bound.
 * `median`: the representative figure (a line's middle price, scaled; a total's line medians
 * added up). Absent on plans made before 2026-11-09.
 */
const amountSchema = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), low: decimal, high: decimal, median: decimal.optional(), bound: bound.optional() }).strict()
export type PlanAmount = z.infer<typeof amountSchema>

/** A web price kept for a line: as found on its page, with the site and link. */
const priceSchema = z
  .object({
    amount: decimal,
    scale: z.enum(["none", "thousand", "lakh", "crore", "million"]),
    currency: z.string().regex(/^[A-Z]{3}$/),
    /** day: a day for the whole party (a car's day hire); day_person: a day for each traveller. */
    per: z.enum(["total", "night", "person", "person_night", "day_person", "day"]),
    bound: z.enum(["from", "up_to"]).optional(),
    /** What the price is for (an airline, a hotel, a kind of meal, a mode, a place or tour), found next to it on its page. Required for a new trip price; optional for older stored plans. */
    about: text(80).optional(),
    /** The price in the plan's currency when found in another (rates.ts): worked out in code, approximate, always shown beside the original. */
    converted: z.object({ currency: z.string().regex(/^[A-Z]{3}$/), amount: decimal }).strict().optional(),
    site,
    url,
  })
  .strict()
export type PlanPrice = z.infer<typeof priceSchema>

const lineSchema = z
  .object({
    line: z.enum(PLAN_LINES),
    /** goal: the person's own goal; web: prices found; worked_out: by the app from other lines; none: no estimate; not_estimated: left to the person (shopping). */
    from: z.enum(["goal", "web", "worked_out", "none", "not_estimated"]),
    amounts: z.array(amountSchema).max(4),
    /** How it was worked out, or why there is no estimate, in code's words. */
    how: text(400),
    prices: z.array(priceSchema).max(6),
    /** Pages found for a line that couldn't be checked in time: kept, so a spent lookup is never silent. */
    pages: z.array(z.object({ site, url }).strict()).max(6),
    /** Named dishes (food), well-known places (sightseeing), hotels named without a rate (stay) or what a place is known for buying (shopping), each with its page. */
    mentions: z.array(z.object({ name: text(80), site, url }).strict()).max(8).optional(),
  })
  .strict()
export type PlanLine = z.infer<typeof lineSchema>

const nameSchema = z
  .object({
    name: text(80),
    site,
    url,
    stars: z.union([z.literal(4), z.literal(5)]).optional(),
    rate: priceSchema.optional(),
  })
  .strict()
export type PlanName = z.infer<typeof nameSchema>

/** Names looked up: the ones confirmed, or why there are none. */
const namesSchema = z.object({ listed: z.array(nameSchema).max(6), note: text(300) }).strict()
export type PlanNames = z.infer<typeof namesSchema>

const verdictSchema = z.object({ verdict: text(40), summary: text(1200) }).strict()
export type PlanVerdict = z.infer<typeof verdictSchema>

/** One signal of a trip plan's verdict: whether it holds, with its figures in words. */
const signalSchema = z.object({ met: z.enum(["yes", "no", "unknown"]), summary: text(600) }).strict()
export type PlanSignal = z.infer<typeof signalSchema>

/**
 * A model on a shortlist (10.9 follow-up): a make and model from the app's list and its price,
 * both found in code on one listing page (plan/candidates.ts), picked by id, with only what the
 * same card says beside them. Listed on that page, not Roma's recommendation.
 */
const candidateSchema = z
  .object({
    make: text(40),
    model: text(40),
    currency: z.string().regex(/^[A-Z]{3}$/),
    low: decimal,
    high: decimal,
    bound: z.enum(["from", "up_to"]).optional(),
    exShowroom: z.boolean(),
    facts: z.array(text(30)).max(6),
    site,
    url,
    /** Whether its higher price, less any trade-in or deposit, fits free money by the month after other goals. */
    fit: signalSchema,
  })
  .strict()
export type PlanCandidate = z.infer<typeof candidateSchema>

const candidatesSchema = z
  .object({
    listed: z.array(candidateSchema).max(6),
    /** Where the list came from, or why it is empty, in code's words. */
    note: text(400),
    /** The budget the list was kept to: the person's own, or free money by the month (records); null when there was none. */
    budget: z.object({ currency: z.string().regex(/^[A-Z]{3}$/), minor: z.number().int(), from: z.enum(["intake", "records"]) }).strict().nullable(),
  })
  .strict()
export type PlanCandidates = z.infer<typeof candidatesSchema>

export const checkedPlanSchema = z
  .object({
    v: z.literal(1),
    kind: z.enum(["trip", "purchase"]),
    /** What the plan is for, as the intake gave it (null: skipped), and its title. */
    intake: z
      .object({
        title: text(160),
        fields: z.array(z.object({ label: text(40), value: text(80).nullable() }).strict()).max(8),
        /** The request itself, for "Add to my goals" (goal.ts). Absent on plans made before it. */
        request: planRequest.optional(),
      })
      .strict(),
    lines: z.array(lineSchema).max(PLAN_LINES.length),
    /** Already saved toward a matching goal (purchase), profile currency minor units; null when none. */
    saved: z.object({ goal: text(80), minor: z.number().int().min(0), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().nullable(),
    carriers: namesSchema.nullable(),
    /** Plans made before the follow-up only: hotels are now on the stay line. */
    hotels: namesSchema.nullable(),
    verdicts: z
      .object({
        /** The plan's total per currency (lines with an estimate only); prices in another currency with a rate are converted first, so a new plan has one. */
        totals: z.array(amountSchema).max(4),
        records: verdictSchema,
        web: verdictSchema,
        /** A trip's verdict from both signals: free money by the travel month, and the past trip's cost. Absent on purchases and older plans. */
        both: z.object({ verdict: text(40), summary: text(600), money: signalSchema, past: signalSchema }).strict().optional(),
        /**
         * The projection's own figures behind the verdict with web estimates, profile currency minor units: free money by
         * the month after other goals (negative when other goals take more), and the extra a month needed (0 when it fits).
         * Null when the projection has none; absent on older plans and when no verdict was worked out.
         */
        figures: z
          .object({ currency: z.string().regex(/^[A-Z]{3}$/), month: month.nullable(), freeMinor: z.number().int().nullable(), extraMonthlyMinor: z.number().int().min(0).nullable() })
          .strict()
          .optional(),
        /**
         * Why no web lookup ran, when none could: the daily or monthly allowance used up, lookups
         * off, or the person chose the records only. In code's words, with when it resets. Absent
         * when lookups ran, and on older plans.
         */
        webOff: z.object({ reason: z.enum(["daily_limit", "monthly_cap", "off", "records_only"]), message: text(300) }).strict().optional(),
      })
      .strict(),
    /** What would make it fit: a title and one line each (older plans: one sentence each). */
    changes: z.array(z.union([text(200), z.object({ title: text(80), detail: text(200) }).strict()])).max(6),
    assumptions: z.array(text(400)).max(16),
    sources: z.array(z.object({ site, url }).strict()).max(40),
    /** A purchase plan's model shortlist (a bike or car asked for without a model). Absent on every other plan. */
    candidates: candidatesSchema.optional(),
  })
  .strict()

export type CheckedPlan = z.infer<typeof checkedPlanSchema>
export type PlanChange = CheckedPlan["changes"][number]
