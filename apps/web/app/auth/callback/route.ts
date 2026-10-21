import type { EmailOtpType } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"
import { safeNextPath } from "@/lib/auth/redirect"
import { createClient } from "@/lib/supabase/server"

// Landing point for every auth link:
//   ?code=…                    Google OAuth and same-browser email links (PKCE)
//   ?token_hash=…&type=…       email templates using {{ .TokenHash }} (works on any device)
// `next` is untrusted and is reduced to a same-site path.

const OTP_TYPES = new Set<EmailOtpType>(["signup", "email", "recovery", "invite", "magiclink", "email_change"])

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && OTP_TYPES.has(value as EmailOtpType)
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url))

  // Provider-side failure (e.g. the user cancelled Google consent).
  if (params.has("error")) return to("/sign-in?notice=oauth-failed")

  const next = safeNextPath(params.get("next"))
  const code = params.get("code")
  const tokenHash = params.get("token_hash")
  const type = params.get("type")
  const supabase = await createClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return to(next)
  } else if (tokenHash && isOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) return to(type === "recovery" ? "/update-password" : next)
  }

  return to("/sign-in?notice=link-invalid")
}
