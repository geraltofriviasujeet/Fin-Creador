import { describe, expect, it } from "vitest";
import { INDIAN_CITIES, INDIAN_STATES } from "./goal-data";
import { COUNTRY_NAMES } from "./region-data";
import { TRIP_PLACE_ALIASES, normalizePlace, tripPlaceScope } from "./trip-places";

describe("tripPlaceScope", () => {
  it("treats Indian states, union territories and cities as domestic", () => {
    expect(tripPlaceScope("Goa")).toBe("domestic");
    expect(tripPlaceScope("ladakh")).toBe("domestic");
    expect(tripPlaceScope("  Kochi ")).toBe("domestic");
    expect(tripPlaceScope("Prayagraj")).toBe("domestic");
    expect(tripPlaceScope("Allahabad")).toBe("domestic");
    expect(tripPlaceScope("Bangalore")).toBe("domestic");
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
    const domestic = new Set([...INDIAN_STATES, ...INDIAN_CITIES].map(normalizePlace));
    const countries = Object.entries(COUNTRY_NAMES).filter(([code]) => code !== "IN").map(([, name]) => normalizePlace(name));
    expect(countries.filter((c) => domestic.has(c))).toEqual([]);
    for (const [name, scope] of Object.entries(TRIP_PLACE_ALIASES)) {
      const listed = domestic.has(normalizePlace(name)) ? "domestic" : countries.includes(normalizePlace(name)) ? "international" : null;
      expect(listed === null || listed === scope, name).toBe(true);
    }
  });
});
