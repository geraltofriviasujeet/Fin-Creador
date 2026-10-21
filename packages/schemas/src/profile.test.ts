import { describe, expect, it } from "vitest";
import { PROFILE_DEFAULTS, profilePreferencesSchema } from "./profile";

describe("profilePreferencesSchema", () => {
  it("applies India-first defaults when fields are omitted", () => {
    expect(profilePreferencesSchema.parse({})).toEqual(PROFILE_DEFAULTS);
    expect(PROFILE_DEFAULTS).toEqual({
      country: "IN",
      currency: "INR",
      timeZone: "Asia/Kolkata",
    });
  });

  it("normalizes country and currency codes", () => {
    const result = profilePreferencesSchema.parse({
      country: " us ",
      currency: "usd",
      timeZone: "America/New_York",
    });
    expect(result).toEqual({
      country: "US",
      currency: "USD",
      timeZone: "America/New_York",
    });
  });

  it.each([
    ["country", "IND"],
    ["country", "1N"],
    ["currency", "RUPEE"],
    ["currency", "IN"],
    ["timeZone", "Mars/Olympus_Mons"],
    ["timeZone", ""],
  ])("rejects invalid %s %j", (field, value) => {
    const result = profilePreferencesSchema.safeParse({ [field]: value });
    expect(result.success).toBe(false);
  });
});
