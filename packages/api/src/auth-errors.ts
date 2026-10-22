// Maps Supabase Auth error codes to user-facing messages, for web and mobile alike.
// Messages never reveal whether an email is registered, and raw provider messages are
// never shown.

export type AuthErrorLike = { code?: string | undefined; status?: number | undefined } | null | undefined

export type AuthMessage = {
  message: string
  /** Form field the message belongs to, when it is about one input. */
  field?: "email" | "password"
  /** Lets the UI offer a follow-up, e.g. resending the confirmation email. */
  code?: "email_not_confirmed"
}

const GENERIC = "Something went wrong. Please try again."

/** The answer every sign-up gets when email confirmation is on, for new and existing emails alike. */
export const SIGN_UP_CHECK_EMAIL = "Check your email for a link to confirm your account, then sign in."

const EXISTING_ACCOUNT_CODES = new Set(["user_already_exists", "email_exists"])

/**
 * True when sign-up failed only because the email already has an account. Callers must
 * answer exactly as for a new sign-up, so the response never reveals that an email is
 * registered. (Supabase returns this for confirmed accounts; unconfirmed ones already get
 * the normal answer.)
 */
export function isExistingAccountError(error: AuthErrorLike): boolean {
  return !!error?.code && EXISTING_ACCOUNT_CODES.has(error.code)
}

export function authErrorMessage(error: AuthErrorLike): AuthMessage {
  switch (error?.code) {
    case "invalid_credentials":
      return { message: "Email or password is incorrect." }
    case "email_not_confirmed":
      return {
        message: "Please confirm your email first. Check your inbox for the link, or send a new one.",
        code: "email_not_confirmed",
      }
    case "weak_password":
      return { message: "Choose a stronger password.", field: "password" }
    case "same_password":
      return { message: "Your new password must be different from the current one.", field: "password" }
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return { message: "Too many attempts. Please wait a few minutes and try again." }
    case "signup_disabled":
      return { message: "New sign-ups are currently closed." }
    case "session_not_found":
    case "otp_expired":
      return { message: "Your link has expired. Please request a new one." }
    default:
      if (error?.status === 429) return { message: "Too many attempts. Please wait a few minutes and try again." }
      return { message: GENERIC }
  }
}
