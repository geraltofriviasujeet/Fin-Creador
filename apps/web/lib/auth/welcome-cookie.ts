import "server-only"
import { cookies } from "next/headers"

// The welcome carousel shows once after each sign-in (owner review 2026-11-20), not on reloads
// or navigation. Every successful sign-in path (password, sign-up with an immediate session, the
// auth callback for Google and email links) sets this short-lived cookie; the app layout shows the
// welcome while it is present and the person hasn't opted out (profiles.welcome_hidden_at); a
// server action clears it when the welcome closes (it is httpOnly, so the page's JS can't), and
// sign-out clears it too. It holds no personal data, only "1".

export const WELCOME_COOKIE = "fc_welcome"
const ONE_HOUR = 60 * 60

/** A successful sign-in: show the welcome on the next app page. */
export async function markSignedIn(): Promise<void> {
  const store = await cookies()
  store.set(WELCOME_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_HOUR,
    secure: process.env.NODE_ENV === "production",
  })
}

/** Whether this browser has just signed in and hasn't closed the welcome yet. */
export async function welcomePending(): Promise<boolean> {
  return (await cookies()).get(WELCOME_COOKIE)?.value === "1"
}

/** The welcome closed (or the person signed out). */
export async function clearWelcome(): Promise<void> {
  const store = await cookies()
  store.delete({ name: WELCOME_COOKIE, path: "/" })
}
