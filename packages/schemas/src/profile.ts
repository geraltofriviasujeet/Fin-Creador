import { z } from "zod";
import { canonicalTimeZone, isCountryCode, isKnownTimeZone } from "./regions";

// India-first defaults (CLAUDE.md §5). Must match the column defaults in the profiles migration.
export const PROFILE_DEFAULTS = {
  country: "IN",
  currency: "INR",
  timeZone: "Asia/Kolkata",
} as const;

// The bundled list first: Hermes (mobile) may not resolve every zone through Intl.
// The database trigger is the final check against pg_timezone_names.
function isValidTimeZone(value: string): boolean {
  if (isKnownTimeZone(value)) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** ISO 3166-1 alpha-2 country code, normalized to upper case. */
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Use a 2-letter country code, e.g. IN")
  .refine(isCountryCode, "Unknown country");

/** ISO 4217 currency code, normalized to upper case. */
export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. INR");

/** IANA time zone identifier, e.g. Asia/Kolkata. Legacy aliases are mapped to current names. */
export const timeZoneSchema = z
  .string()
  .trim()
  .min(1, "Time zone is required")
  .refine(isValidTimeZone, "Unknown time zone")
  .transform(canonicalTimeZone);

export const profilePreferencesSchema = z.object({
  country: countryCodeSchema.default(PROFILE_DEFAULTS.country),
  currency: currencyCodeSchema.default(PROFILE_DEFAULTS.currency),
  timeZone: timeZoneSchema.default(PROFILE_DEFAULTS.timeZone),
});

export type ProfilePreferences = z.infer<typeof profilePreferencesSchema>;

/** Optional phone in E.164 form after removing spaces, dashes and brackets. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-()]/g, ""))
  .refine((v) => v === "" || /^\+[1-9]\d{6,14}$/.test(v), "Use international format, e.g. +91 98765 43210")
  .transform((v) => (v === "" ? null : v));

export const profileUpdateSchema = profilePreferencesSchema.extend({
  displayName: z
    .string()
    .trim()
    .min(1, "Enter your name")
    .max(80, "Keep your name under 80 characters"),
  phone: phoneSchema.optional().transform((v) => v ?? null),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
