// Domestic or international, from the destination's name (Roma's trip check, Sprint 10.5).
// Decided here from lists, never by a model: Indian states, union territories and cities
// (goal-data.ts) are domestic; countries other than India (region-data.ts) are international;
// plus the common other names below. Only an exact name counts (any case, accents and "&"
// ignored); anything else is unknown, and Roma asks. Refreshed with the other lists
// (docs/quarterly-list-refresh.md, LISTS_REVIEWED_ON.places).

import { INDIAN_CITIES, INDIAN_STATES } from "./goal-data";
import { COUNTRY_NAMES } from "./region-data";

export type TripPlaceScope = "domestic" | "international";

/** Other names people use for places on the lists. Names only, each unambiguous. */
export const TRIP_PLACE_ALIASES: Readonly<Record<string, TripPlaceScope>> = {
  // Indian places by their older or shorter names.
  Andaman: "domestic",
  Bangalore: "domestic",
  Bombay: "domestic",
  Calcutta: "domestic",
  Cochin: "domestic",
  Gurgaon: "domestic",
  Kashmir: "domestic",
  Madras: "domestic",
  Mangalore: "domestic",
  Mysore: "domestic",
  "New Delhi": "domestic",
  Orissa: "domestic",
  Pondicherry: "domestic",
  Trivandrum: "domestic",
  Vizag: "domestic",
  // Countries by their usual other names.
  America: "international",
  "Czech Republic": "international",
  England: "international",
  Holland: "international",
  Scotland: "international",
  Turkey: "international",
  UAE: "international",
  UK: "international",
  USA: "international",
  "United Arab Emirates": "international",
  Wales: "international",
};

/** A place name as compared: lower case, no accents, "&" as "and", single spaces, no leading "the". */
export function normalizePlace(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^the /, "");
}

/** "Allahabad (Prayagraj)" is found by either name. */
const namesOf = (listed: string) => {
  const m = /^(.+?) \((.+)\)$/.exec(listed);
  return m ? [m[1]!, m[2]!] : [listed];
};

function buildIndex(): ReadonlyMap<string, TripPlaceScope> {
  const index = new Map<string, TripPlaceScope>();
  const add = (name: string, scope: TripPlaceScope) => {
    const key = normalizePlace(name);
    if (key && !index.has(key)) index.set(key, scope);
  };
  for (const place of [...INDIAN_STATES, ...INDIAN_CITIES]) for (const name of namesOf(place)) add(name, "domestic");
  for (const [code, name] of Object.entries(COUNTRY_NAMES)) if (code !== "IN") add(name, "international");
  for (const [name, scope] of Object.entries(TRIP_PLACE_ALIASES)) add(name, scope);
  return index;
}

let index: ReadonlyMap<string, TripPlaceScope> | null = null;

/** Domestic or international for a listed place; null when the place isn't on the lists. */
export function tripPlaceScope(destination: string): TripPlaceScope | null {
  index ??= buildIndex();
  return index.get(normalizePlace(destination)) ?? null;
}
