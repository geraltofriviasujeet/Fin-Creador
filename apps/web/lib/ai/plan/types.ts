import { z } from "zod"
import { TRIP_STYLES } from "../search/query"

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

/** An amount in one currency: one figure, or low to high; a minimum or maximum when bound. */
const amountSchema = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), low: decimal, high: decimal, bound: bound.optional() }).strict()
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

export const checkedPlanSchema = z
  .object({
    v: z.literal(1),
    kind: z.enum(["trip", "purchase"]),
    /** What the plan is for, as the intake gave it (null: skipped), and its title. */
    intake: z
      .object({
        title: text(160),
        fields: z.array(z.object({ label: text(40), value: text(80).nullable() }).strict()).max(8),
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
      })
      .strict(),
    changes: z.array(text(200)).max(6),
    assumptions: z.array(text(400)).max(16),
    sources: z.array(z.object({ site, url }).strict()).max(40),
  })
  .strict()

export type CheckedPlan = z.infer<typeof checkedPlanSchema>
