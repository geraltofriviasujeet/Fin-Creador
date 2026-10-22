import type { ProfileUpdate } from "@fin-creador/schemas"
import { canonicalTimeZone } from "@fin-creador/schemas"
import type { ProfileEditable, ProfileRow } from "./index"

/** Columns read for the profile form; select these, nothing more. */
export const PROFILE_FORM_COLUMNS = "display_name, phone, country, currency, time_zone" as const

/** Form values (all strings) for a profile row, as both clients prefill their forms. */
export type ProfileFormValues = { displayName: string; phone: string; country: string; currency: string; timeZone: string }

export function profileFormValues(row: Pick<ProfileRow, "display_name" | "phone" | "country" | "currency" | "time_zone">): ProfileFormValues {
  return {
    displayName: row.display_name ?? "",
    phone: row.phone ?? "",
    country: row.country,
    currency: row.currency,
    timeZone: canonicalTimeZone(row.time_zone),
  }
}

/** Maps validated form data to the columns a user may update (the migration's column grants). */
export function profileUpdateColumns(p: ProfileUpdate): ProfileEditable {
  return {
    display_name: p.displayName,
    phone: p.phone,
    country: p.country,
    currency: p.currency,
    time_zone: p.timeZone,
  }
}

/** Postgres error code raised by the profiles time-zone trigger (invalid_parameter_value). */
export const INVALID_TIME_ZONE_CODE = "22023"
