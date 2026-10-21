// ISO 3166-1 alpha-2 codes (officially assigned). Display names come from Intl.DisplayNames.
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ " +
  "BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM " +
  "DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS " +
  "GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN " +
  "KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ " +
  "MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM " +
  "PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV " +
  "SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
  "VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

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

/** Sorted IANA time zones for pickers, with current names and UTC included. */
export function listTimeZones(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set([...supported.map(canonicalTimeZone), "UTC", "Asia/Kolkata"])].sort();
}

/** Sorted ISO 4217 currency codes supported by this runtime, INR always included. */
export function listCurrencies(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : [];
  return [...new Set([...supported, "INR"])].sort();
}
