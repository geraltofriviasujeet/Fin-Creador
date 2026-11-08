// The trip check (Sprint 10.5): what a trip would cost, estimated from the person's own
// records only, never by a model and never from outside prices. Exact integer arithmetic.
//
// Rules:
//  - Past trips are not stored as such. A travel run is a group of expenses in a Travel
//    category where no two neighbouring entries are more than TRIP_RUN_GAP_DAYS days apart,
//    within the last TRIP_LOOKBACK_MONTHS months. Runs longer than TRIP_RUN_MAX_DAYS days are
//    not offered (that is regular travel spending, not a trip). The records don't say how
//    many travelled or where, so a run is used only after the person confirms both.
//  - Trips are counted in days: a run from its first to its last entry, both counted; a trip
//    goal by its days; a new trip of N nights as N + 1 days.
//  - Scaling: a trip goal's transport and visa/insurance lines per traveller; its other lines
//    per traveller-day. A run's amount per traveller-day. Each rounded half away from zero.
//  - Only comparables of the same scope (domestic or international) are used. The estimate is
//    the median of what each comparable scales to. None: no estimate.
//  - A plan's past-trip signal (10.9 follow-up) compares the plan with one run as it was
//    spent, unscaled (who went and where isn't known): the most recent run of similar length
//    (within SIMILAR_DAYS_MIN days, or SIMILAR_DAYS_PERCENT% of the plan's days if more), else
//    the most recent of any length. A run with no Travel spending left (refunds) isn't one.
import { type IsoDate, parseIsoDate } from "./dates";
import { medianMinor } from "./goal-projection";
import { type TripCostLine, type TripDetails, divRoundHalfAway } from "./goals";
import { addMinor } from "./money";

export const TRIP_RUN_GAP_DAYS = 3;
export const TRIP_RUN_MAX_DAYS = 30;
export const TRIP_LOOKBACK_MONTHS = 24;
export const SIMILAR_DAYS_MIN = 2;
export const SIMILAR_DAYS_PERCENT = 25;

export type TripScope = TripDetails["scope"];

/** Lines that are paid once per traveller, however long the trip. */
export const PER_TRAVELLER_LINES: readonly TripCostLine[] = ["transport", "visaInsurance"];

export interface TripSize {
  days: number;
  travellers: number;
}

export type TripComparable =
  | { kind: "goal"; name: string; scope: TripScope; days: number; travellers: number; costs: Record<TripCostLine, number> }
  | { kind: "run"; from: IsoDate; to: IsoDate; scope: TripScope; days: number; travellers: number; amountMinor: number };

export interface TravelRun {
  from: IsoDate;
  to: IsoDate;
  days: number;
}

export interface TripEstimate {
  estimateMinor: number;
  /** What each comparable used scales to, in the order given. */
  scaled: { comparable: TripComparable; minor: number }[];
}

const dayNumber = (date: IsoDate) => {
  const p = parseIsoDate(date);
  if (!p) throw new RangeError("Not an ISO date");
  return Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;
};

/** Days from `from` to `to`, both counted. */
export const daysInclusive = (from: IsoDate, to: IsoDate) => dayNumber(to) - dayNumber(from) + 1;

/** Travel runs from the dates of Travel expenses (any order, repeats allowed), newest first. */
export function findTravelRuns(dates: readonly IsoDate[]): TravelRun[] {
  const sorted = [...new Set(dates)].sort();
  const runs: TravelRun[] = [];
  let from: IsoDate | null = null;
  let last: IsoDate | null = null;
  const close = () => {
    if (from === null || last === null) return;
    const days = daysInclusive(from, last);
    if (days <= TRIP_RUN_MAX_DAYS) runs.push({ from, to: last, days });
  };
  for (const date of sorted) {
    if (last !== null && dayNumber(date) - dayNumber(last) > TRIP_RUN_GAP_DAYS) {
      close();
      from = null;
    }
    from ??= date;
    last = date;
  }
  close();
  return runs.reverse();
}

const scale = (minor: number, num: number, den: number) => Number(divRoundHalfAway(BigInt(minor) * BigInt(num), BigInt(den)));

/** One comparable scaled to the trip's size. */
export function scaleComparable(c: TripComparable, trip: TripSize): number {
  if (c.days < 1 || c.travellers < 1 || trip.days < 1 || trip.travellers < 1) throw new RangeError("Days and travellers must be at least 1");
  if (c.kind === "run") return scale(c.amountMinor, trip.travellers * trip.days, c.travellers * c.days);
  let perTraveller = 0;
  let perDay = 0;
  for (const [line, minor] of Object.entries(c.costs) as [TripCostLine, number][]) {
    if (PER_TRAVELLER_LINES.includes(line)) perTraveller = addMinor(perTraveller, minor);
    else perDay = addMinor(perDay, minor);
  }
  return addMinor(scale(perTraveller, trip.travellers, c.travellers), scale(perDay, trip.travellers * trip.days, c.travellers * c.days));
}

/** The estimate from comparables of the trip's scope; null when there are none. */
export function tripEstimate(comparables: readonly TripComparable[], scope: TripScope, trip: TripSize): TripEstimate | null {
  const used = comparables.filter((c) => c.scope === scope);
  if (used.length === 0) return null;
  const scaled = used.map((comparable) => ({ comparable, minor: scaleComparable(comparable, trip) }));
  return { estimateMinor: medianMinor(scaled.map((s) => s.minor)), scaled };
}

/**
 * The largest value of one dimension (days or travellers, from 1 to `upTo`) whose estimate is
 * at most `availableMinor`, the other kept as given; null when even 1 doesn't fit. The
 * estimate grows with either dimension, so the first that doesn't fit ends the search.
 */
export function largestThatFits(
  comparables: readonly TripComparable[],
  scope: TripScope,
  trip: TripSize,
  dimension: keyof TripSize,
  upTo: number,
  availableMinor: number,
): number | null {
  let best: number | null = null;
  for (let n = 1; n <= upTo; n++) {
    const e = tripEstimate(comparables, scope, { ...trip, [dimension]: n });
    if (!e || e.estimateMinor > availableMinor) break;
    best = n;
  }
  return best;
}

/** Whether a run's days are close enough to a trip's to compare with. */
export function similarLength(runDays: number, tripDays: number): boolean {
  const allowed = Math.max(SIMILAR_DAYS_MIN, Math.ceil((tripDays * SIMILAR_DAYS_PERCENT) / 100));
  return Math.abs(runDays - tripDays) <= allowed;
}

/**
 * The run a plan compares with: `runs` newest first (as findTravelRuns gives them); the most
 * recent of similar length to `tripDays`, else the most recent. Null days: the most recent.
 */
export function pastTripRun<R extends TravelRun & { travelMinor: number }>(runs: readonly R[], tripDays: number | null): { run: R; similar: boolean } | null {
  const spent = runs.filter((r) => r.travelMinor > 0);
  const similar = tripDays === null ? undefined : spent.find((r) => similarLength(r.days, tripDays));
  if (similar) return { run: similar, similar: true };
  return spent[0] ? { run: spent[0], similar: false } : null;
}
