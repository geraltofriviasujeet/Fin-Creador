// How a signed-in person is shown without exposing their full email: the sidebar avatar and the
// "Continue as" card on the sign-in and sign-up pages.

/** Up to two initials from the display name, or the email's first letter; "?" when neither. */
export function avatarInitials(name: string | null, email: string): string {
  const fromName = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
  return fromName || email.trim().charAt(0).toUpperCase() || "?"
}

/**
 * "a•••@example.com": the first letter, three dots, then the domain. Anything that isn't a
 * plain local@domain address is masked entirely, so no part of it leaks by accident.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@")
  if (at < 1 || at === email.length - 1) return "•••"
  return `${email.charAt(0)}•••${email.slice(at)}`
}
