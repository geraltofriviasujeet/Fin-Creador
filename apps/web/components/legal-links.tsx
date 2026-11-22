import { cn } from "cn"
import { PRIVACY_URL, TERMS_URL } from "@/lib/site"

const LINK = "font-semibold text-ink underline underline-offset-4 hover:no-underline"

/** "Terms" and "Privacy Policy" on the FinCreador website, each in a new tab. */
export function TermsLink({ children = "Terms" }: { children?: React.ReactNode }) {
  return (
    <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

export function PrivacyLink({ children = "Privacy Policy" }: { children?: React.ReactNode }) {
  return (
    <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

/** "Terms · Privacy Policy" as one line (Settings, the Roma switch). */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <p className={cn("flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground", className)}>
      <TermsLink />
      <span aria-hidden="true">·</span>
      <PrivacyLink />
    </p>
  )
}
