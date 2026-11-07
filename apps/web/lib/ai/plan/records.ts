import type { GoalItem } from "@fin-creador/api"
import { divRoundHalfAway, goalProjection, monthStart } from "@fin-creador/domain"
import { normalizePlace } from "@fin-creador/schemas"
import { goalProjectionTool, loadProjectionBasis, otherGoals } from "../tools/goals"
import { tripCheckTool } from "../tools/trip"
import { NO_LOOKUPS, type ToolContext, ToolError, type ToolOutput } from "../tools/types"
import type { PlanRecords } from "./run"
import type { PlanLineName, PlanRequest } from "./types"

// What a plan takes from the person's records (10.9): the records-only verdict from the same
// tools as a question (trip_check, goal_projection), a matching goal's cost lines and what is
// saved toward it, and a projection on the same months, claims and other goals to check the
// plan's total with. No balance is taken: only the amount saved toward the matching goal.

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && normalizePlace(a) === normalizePlace(b)

/** Scales a goal's cost: per traveller (transport) or per traveller per day (the rest), half away from zero. */
function scaled(minor: number, perTraveller: boolean, goal: { people: number; days: number }, plan: { travellers: number; days: number }): number {
  const num = BigInt(minor) * BigInt(plan.travellers) * BigInt(perTraveller ? 1 : plan.days)
  const den = BigInt(goal.people) * BigInt(perTraveller ? 1 : goal.days)
  return Number(divRoundHalfAway(num, den))
}

const verdictOf = (out: ToolOutput) =>
  out.check
    ? { verdict: out.check.verdict, summary: out.check.summary }
    : { verdict: "No verdict.", summary: out.needs?.question ?? "No verdict from your records." }

const skippedWords = (fields: string[]) => `${fields.join(" and ")} ${fields.length === 1 ? "was" : "were"} skipped`

export async function loadPlanRecords(ctx: ToolContext, request: PlanRequest): Promise<PlanRecords> {
  const { today, currency } = ctx
  const basis = await loadProjectionBasis(ctx)
  const claims = [...basis.claims.loans, ...basis.claims.dues]
  const all = [...basis.goals.active, ...basis.goals.archived].filter((g) => g.goal.currency === currency)
  const targetDate = request.month ? `${request.month}-01` : null
  const future = targetDate !== null && targetDate >= monthStart(today)

  const run = async (f: () => Promise<ToolOutput>) => {
    try {
      return await f()
    } catch (error) {
      return error instanceof ToolError ? error.message : "Your records couldn't be read just now."
    }
  }

  if (request.kind === "trip") {
    const { destination, month, nights, travellers } = request
    const missing = [destination === null ? "the destination" : null, month === null ? "the month" : null, nights === null ? "nights" : null, travellers === null ? "travellers" : null].filter(
      (x): x is string => x !== null,
    )
    const out = missing.length === 0 ? await run(() => tripCheckTool.run(ctx, { destination: destination!, month: month!, nights: nights!, travellers: travellers! })) : null
    const records =
      out === null
        ? { verdict: "No verdict.", summary: `No verdict from your records: ${skippedWords(missing)}.` }
        : typeof out === "string"
          ? { verdict: "No verdict.", summary: `No verdict from your records: ${out}` }
          : verdictOf(out)

    // A trip goal for the same place gives its lines, scaled to this plan (needs nights and travellers).
    const item = all.find((g) => g.answers?.type === "trip" && same(g.answers.details.place, destination))
    let goal: PlanRecords["goal"] = null
    if (item?.answers?.type === "trip" && nights !== null && travellers !== null) {
      const d = item.answers.details
      const plan = { travellers, days: nights + 1 }
      const c = d.costs
      const lines: Partial<Record<PlanLineName, number>> = {
        transport: scaled(c.transport, true, d, plan),
        stay: scaled(c.stay, false, d, plan),
        food: scaled(c.food, false, d, plan),
        sightseeing: scaled(c.activities, false, d, plan),
        shopping: scaled(c.shopping, false, d, plan),
        buffer: scaled(c.buffer, false, d, plan),
      }
      goal = {
        name: item.goal.name,
        lines,
        how: `From your trip goal ${item.goal.name} (${d.people} ${d.people === 1 ? "traveller" : "travellers"}, ${d.days} days), scaled to ${travellers} ${travellers === 1 ? "traveller" : "travellers"} and ${plan.days} days. A goal's costs are what was planned, not what was spent.`,
      }
    }
    const others = otherGoals(basis.goals.active, currency, null).map((g) => g.plan)
    return {
      records,
      goal,
      saved: null,
      project: future ? (targetMinor) => goalProjection({ today, targetMinor, savedMinor: 0, targetDate: targetDate!, months: basis.complete, claims, otherGoals: others }) : null,
      assumptions: typeof out === "object" && out?.check ? out.check.assumptions.filter((a) => a !== NO_LOOKUPS) : [],
    }
  }

  // A purchase: the person's own goal for it, if they have one.
  const matches = (g: GoalItem) => {
    const a = g.answers
    if (request.item === "house") return a?.type === "house"
    return a?.type === "vehicle" && a.details.vehicle === request.item && (request.make === null || same(a.details.make, request.make)) && (request.model === null || same(a.details.model, request.model))
  }
  const item = basis.goals.active.find((g) => g.goal.currency === currency && matches(g)) ?? null
  const out = item ? await run(() => goalProjectionTool.run(ctx, { goal: item.goal.name })) : null
  const what = request.item === "house" ? "house" : request.item
  const records =
    out === null
      ? { verdict: "No verdict.", summary: `No estimate from your records: there's no ${what} goal to check against. A goal with its price would let Roma check it from your records.` }
      : typeof out === "string"
        ? { verdict: "No verdict.", summary: `No verdict from your records: ${out}` }
        : verdictOf(out)
  const a = item?.answers
  const lines: Partial<Record<PlanLineName, number>> =
    a?.type === "vehicle" ? { price: a.details.priceMinor, extras: a.details.extrasMinor } : a?.type === "house" ? { price: a.details.priceMinor } : {}
  const saved = item ? { goal: item.goal.name, minor: item.goal.savedMinor } : null
  const others = otherGoals(basis.goals.active, currency, item?.goal.id ?? null).map((g) => g.plan)
  return {
    records,
    goal: item ? { name: item.goal.name, lines, how: `From your goal ${item.goal.name}: the price you planned.` } : null,
    saved,
    project: future
      ? (targetMinor) => goalProjection({ today, targetMinor, savedMinor: saved?.minor ?? 0, targetDate: targetDate!, months: basis.complete, claims, otherGoals: others })
      : null,
    assumptions: typeof out === "object" && out?.check ? out.check.assumptions : [],
  }
}
