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
      "E2E tests only run against a local Supabase (NEXT_PUBLIC_SUPABASE_URL must point at 127.0.0.1 or localhost). " +
        "They run in CI; see docs/setup.md."
    )
  }
  const res = await fetch(`${MAILPIT_URL}/api/v1/info`).catch(() => null)
  if (!res?.ok) throw new Error(`Mailpit test inbox not reachable at ${MAILPIT_URL}.`)

  // Warm-up: the first test of a run sometimes reached the Overview right after sign-up and
  // got "We couldn't load your overview" (cold API and database; the retry passed). Wait
  // until Auth and the REST API answer, and PostgREST has loaded its schema, before testing.
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  const deadline = Date.now() + 30_000
  for (;;) {
    const [auth, rest] = await Promise.all([
      fetch(`${url}/auth/v1/health`, { headers }).catch(() => null),
      fetch(`${url}/rest/v1/`, { headers }).catch(() => null),
    ])
    if (auth?.ok && rest?.ok) break
    if (Date.now() > deadline) {
      // Not fatal: the tests themselves show what is wrong.
      console.warn(`Warm-up gave up: auth ${auth?.status ?? "down"}, rest ${rest?.status ?? "down"}.`)
      break
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}
