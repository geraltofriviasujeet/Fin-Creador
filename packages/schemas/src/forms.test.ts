import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  countryOptions,
  currencyOptions,
  firstFieldErrors,
  isKnownTimeZone,
  listCurrencies,
  listTimeZones,
  profileUpdateSchema,
  signInSchema,
  signUpSchema,
  timeZoneOptions,
  timeZoneSchema,
  updatePasswordSchema,
} from "./index";

describe("regions", () => {
  it("has all 249 ISO 3166-1 alpha-2 codes, unique", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    expect(COUNTRY_CODES).toContain("IN");
  });

  it("lists time zones by current IANA names (Asia/Kolkata, not Asia/Calcutta)", () => {
    const zones = listTimeZones();
    expect(zones).toContain("Asia/Kolkata");
    expect(zones).toContain("UTC");
    expect(zones).not.toContain("Asia/Calcutta");
    expect(zones).not.toContain("Europe/Kiev");
  });

  it("canonicalizes legacy time zone input", () => {
    expect(timeZoneSchema.parse("Asia/Calcutta")).toBe("Asia/Kolkata");
  });

  it("lists INR among currencies", () => {
    expect(listCurrencies()).toContain("INR");
  });

  it("builds picker options from the bundled lists, not the runtime", () => {
    const countries = countryOptions();
    expect(countries).toHaveLength(249);
    expect(countries.find((o) => o.value === "IN")?.label).toBe("India");
    // Name order, so Åland Islands sits next to Albania rather than at the end.
    expect(countries.slice(0, 3).map((o) => o.value)).toEqual(["AF", "AX", "AL"]);
    expect(currencyOptions().find((o) => o.value === "INR")?.label).toBe("INR — Indian Rupee");
    expect(currencyOptions("XYZ").map((o) => o.value)).toContain("XYZ");
    expect(timeZoneOptions("Asia/Calcutta").filter((o) => o.value.startsWith("Asia/K")).map((o) => o.value)).not.toContain(
      "Asia/Calcutta"
    );
    expect(timeZoneOptions().find((o) => o.value === "America/New_York")?.label).toBe("America/New York");
  });

  it("accepts every bundled time zone without needing Intl", () => {
    expect(listTimeZones().every(isKnownTimeZone)).toBe(true);
    expect(isKnownTimeZone("Asia/Calcutta")).toBe(true);
    expect(isKnownTimeZone("Mars/Olympus")).toBe(false);
  });

  it("keeps the first message per field", () => {
    const result = signUpSchema.safeParse({ displayName: "", email: "nope", password: "x" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstFieldErrors(result.error)).toEqual({
        displayName: "Enter your name",
        email: "Enter a valid email address",
        password: "Use at least 8 characters",
      });
    }
  });
});

describe("auth schemas", () => {
  it("normalizes email", () => {
    expect(signInSchema.parse({ email: "  A@Example.COM ", password: "x" }).email).toBe("a@example.com");
  });

  it("rejects bad email and short password on sign-up", () => {
    const result = signUpSchema.safeParse({ displayName: "A", email: "nope", password: "short" });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["email", "password"]));
  });

  it("requires matching passwords", () => {
    const result = updatePasswordSchema.safeParse({ password: "longenough", confirmPassword: "different" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});

describe("profileUpdateSchema", () => {
  it("normalizes phone and applies defaults", () => {
    expect(profileUpdateSchema.parse({ displayName: " Asha ", phone: "+91 98765-43210" })).toEqual({
      displayName: "Asha",
      phone: "+919876543210",
      country: "IN",
      currency: "INR",
      timeZone: "Asia/Kolkata",
    });
  });

  it("treats an empty phone as not provided", () => {
    expect(profileUpdateSchema.parse({ displayName: "Asha", phone: "" }).phone).toBeNull();
  });

  it.each(["12345", "+0123456789", "+91 abc"])("rejects phone %j", (phone) => {
    expect(profileUpdateSchema.safeParse({ displayName: "Asha", phone }).success).toBe(false);
  });

  it("rejects unknown country codes", () => {
    expect(profileUpdateSchema.safeParse({ displayName: "Asha", country: "XX" }).success).toBe(false);
  });
});
