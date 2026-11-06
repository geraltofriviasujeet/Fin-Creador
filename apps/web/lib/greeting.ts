// "Good morning, Asha": the part of day in the person's own time zone, and the first word of
// their display name (left out when there is none). Shared by Overview and Roma.
export function greeting(name: string | null, timeZone: string, now: Date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now))
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"
  const first = name?.trim().split(/\s+/)[0]
  return first ? `Good ${part}, ${first}` : `Good ${part}`
}
