import { MAILPIT_URL } from "./mailpit"

// Safety net: E2E creates users and reads their email, so it must only ever run against
// a throwaway local Supabase. Refuse anything else before a single test starts.
export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  let host = ""
  try {
    host = new URL(url).hostname
  } catch {
    // handled below
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      "E2E tests only run against a local Supabase (NEXT_PUBLIC_SUPABASE_URL must point at 127.0.0.1). " +
        "They run in CI; see docs/setup.md."
    )
  }
  const res = await fetch(`${MAILPIT_URL}/api/v1/info`).catch(() => null)
  if (!res?.ok) throw new Error(`Mailpit test inbox not reachable at ${MAILPIT_URL}.`)
}
