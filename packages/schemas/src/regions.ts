import { COUNTRY_NAMES, CURRENCY_NAMES, RAW_TIME_ZONES } from "./region-data";

// Lists come from the generated region-data.ts rather than the runtime, because Hermes
// (mobile) has neither Intl.supportedValuesOf nor Intl.DisplayNames. Web and mobile
// therefore offer exactly the same choices.

/** ISO 3166-1 alpha-2 codes (officially assigned), in country-name order. */
export const COUNTRY_CODES: readonly string[] = Object.keys(COUNTRY_NAMES);

const COUNTRY_SET = new Set(COUNTRY_CODES);
export const isCountryCode = (code: string) => COUNTRY_SET.has(code);

// ICU (and therefore Intl in Node/browsers) still reports some zones by legacy names,
// e.g. Asia/Calcutta. PostgreSQL's pg_timezone_names and the IANA database use the
// current names, so we always store and display these.
export const LEGACY_TIME_ZONE_ALIASES: Readonly<Record<string, string>> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Godthab": "America/Nuuk",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
  "Africa/Asmera": "Africa/Asmara",
};

export function canonicalTimeZone(zone: string): string {
  return LEGACY_TIME_ZONE_ALIASES[zone] ?? zone;
}

const TIME_ZONES: readonly string[] = [
  ...new Set([...RAW_TIME_ZONES.map(canonicalTimeZone), "UTC", "Asia/Kolkata"]),
].sort();
const TIME_ZONE_SET = new Set(TIME_ZONES);

/** True for a zone in the bundled list, by current or legacy name. */
export const isKnownTimeZone = (zone: string) => TIME_ZONE_SET.has(canonicalTimeZone(zone));

/** Sorted IANA time zones for pickers, with current names and UTC included. */
export function listTimeZones(): string[] {
  return [...TIME_ZONES];
}

/** Sorted ISO 4217 currency codes, INR included. */
export function listCurrencies(): string[] {
  return Object.keys(CURRENCY_NAMES);
}

export type RegionOption = { value: string; label: string };

/** Countries sorted by English name (region-data.ts is generated in that order). */
export function countryOptions(): RegionOption[] {
  return COUNTRY_CODES.map((code) => ({ value: code, label: COUNTRY_NAMES[code] ?? code }));
}

/** Currencies as "INR — Indian Rupee", keeping `current` even if it is not in the list. */
export function currencyOptions(current?: string): RegionOption[] {
  const codes = new Set([...listCurrencies(), ...(current ? [current] : [])]);
  return [...codes].sort().map((code) => ({ value: code, label: `${code} — ${CURRENCY_NAMES[code] ?? code}` }));
}

/** Time zones with readable labels ("America/New York"), keeping `current`. */
export function timeZoneOptions(current?: string): RegionOption[] {
  const zones = new Set([...TIME_ZONES, ...(current ? [canonicalTimeZone(current)] : [])]);
  return [...zones].sort().map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }));
}

export const countryName = (code: string) => COUNTRY_NAMES[code] ?? code;
export const currencyName = (code: string) => CURRENCY_NAMES[code] ?? code;
