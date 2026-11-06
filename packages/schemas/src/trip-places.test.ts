import { describe, expect, it } from "vitest";
import { INDIAN_CITIES, INDIAN_STATES } from "./goal-data";
import { COUNTRY_NAMES } from "./region-data";
import { INDIAN_TRIP_PLACES, TRIP_PLACE_ALIASES, normalizePlace, tripPlaceScope } from "./trip-places";

describe("tripPlaceScope", () => {
  it("treats Indian states, union territories and cities as domestic", () => {
    expect(tripPlaceScope("Goa")).toBe("domestic");
    expect(tripPlaceScope("ladakh")).toBe("domestic");
    expect(tripPlaceScope("  Kochi ")).toBe("domestic");
    expect(tripPlaceScope("Prayagraj")).toBe("domestic");
    expect(tripPlaceScope("Allahabad")).toBe("domestic");
    expect(tripPlaceScope("Bangalore")).toBe("domestic");
  });

  it("treats Indian hill stations, tourist towns, parks and pilgrim places as domestic (10.8)", () => {
    for (const place of ["Manali", "Darjeeling", "Rishikesh", "Ooty", "Udhagamandalam", "Coorg", "Kodagu", "Munnar", "McLeod Ganj", "Hampi", "Jaisalmer", "Kaziranga", "Port Blair", "Sri Vijaya Puram", "Alleppey"]) {
      expect(tripPlaceScope(place), place).toBe("domestic");
    }
  });

  it("treats countries other than India as international", () => {
    expect(tripPlaceScope("Vietnam")).toBe("international");
    expect(tripPlaceScope("vietnam")).toBe("international");
    expect(tripPlaceScope("Turkiye")).toBe("international");
    expect(tripPlaceScope("Antigua and Barbuda")).toBe("international");
    expect(tripPlaceScope("the United Kingdom")).toBe("international");
    expect(tripPlaceScope("USA")).toBe("international");
  });

  it("doesn't know places off the lists, or India itself", () => {
    expect(tripPlaceScope("Dubai")).toBeNull();
    expect(tripPlaceScope("Bali")).toBeNull();
    expect(tripPlaceScope("Goa beaches")).toBeNull();
    expect(tripPlaceScope("India")).toBeNull();
    expect(tripPlaceScope("")).toBeNull();
  });

  it("has no name that is both an Indian place and a country", () => {
    const domestic = new Set([...INDIAN_STATES, ...INDIAN_CITIES, ...INDIAN_TRIP_PLACES].flatMap((p) => p.replace(/\)$/, "").split(" (")).map(normalizePlace));
    const countries = Object.entries(COUNTRY_NAMES).filter(([code]) => code !== "IN").map(([, name]) => normalizePlace(name));
    expect(countries.filter((c) => domestic.has(c))).toEqual([]);
    for (const [name, scope] of Object.entries(TRIP_PLACE_ALIASES)) {
      const listed = domestic.has(normalizePlace(name)) ? "domestic" : countries.includes(normalizePlace(name)) ? "international" : null;
      expect(listed === null || listed === scope, name).toBe(true);
    }
  });

  it("lists each tourist place once, and none already a state or city", () => {
    const names = INDIAN_TRIP_PLACES.map(normalizePlace);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    const official = new Set([...INDIAN_STATES, ...INDIAN_CITIES].map(normalizePlace));
    expect(names.filter((n) => official.has(n))).toEqual([]);
  });
});
