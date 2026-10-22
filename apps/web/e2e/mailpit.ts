// Reads emails captured by the local Supabase test inbox (Mailpit).
export const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324"

/**
 * Our templates (supabase/templates) link straight to the app's callback with a token hash.
 * Supabase's default templates go through its /verify page instead, so matching only this
 * prefix proves the custom templates were used.
 */
const APP_CALLBACK_PREFIX = "http://localhost:3000/auth/callback?token_hash="

type Summary = { ID: string; Subject: string; Created: string }

async function search(email: string, subject: string): Promise<Summary[]> {
  const query = encodeURIComponent(`to:"${email}" subject:"${subject}"`)
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`)
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`)
  const body = (await res.json()) as { messages?: Summary[] }
  return body.messages ?? []
}

/**
 * Waits for the newest email to `email` whose subject contains `subject` and returns its
 * token-hash link to the app's /auth/callback. `after` skips emails that were already there.
 */
export async function waitForAuthLink(
  email: string,
  subject: string,
  { after = 0, timeoutMs = 20_000 }: { after?: number; timeoutMs?: number } = {}
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const messages = (await search(email, subject)).filter((m) => Date.parse(m.Created) > after)
    const newest = messages.sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))[0]
    if (newest) {
      const res = await fetch(`${MAILPIT_URL}/api/v1/message/${newest.ID}`)
      const message = (await res.json()) as { HTML?: string }
      const href = [...(message.HTML ?? "").matchAll(/href="([^"]*)"/g)]
        .map((m) => (m[1] ?? "").replaceAll("&amp;", "&"))
        .find((link) => link.startsWith(APP_CALLBACK_PREFIX))
      if (!href) throw new Error(`"${newest.Subject}" has no ${APP_CALLBACK_PREFIX}… link (custom email template not used?)`)
      return href
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`No "${subject}" email for ${email} within ${timeoutMs} ms`)
}

export async function countEmails(email: string, subject: string): Promise<number> {
  return (await search(email, subject)).length
}
