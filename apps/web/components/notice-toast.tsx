"use client"

import { useEffect, useRef } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "@/components/ui/toast"

// One-off messages after a redirect (e.g. "/sign-in?notice=signed-out"). Only these
// keys are recognised; the URL can never inject its own text.
const NOTICES = {
  "signed-out": () => toast.success("You’ve signed out."),
  "password-updated": () => toast.success("Password updated."),
  "link-invalid": () => toast.error("That link is invalid or has expired.", "Please try again."),
  "link-expired": () => toast.info("Your reset link has expired.", "Enter your email to get a new one."),
  "oauth-failed": () => toast.error("Google sign-in didn’t complete.", "Please try again."),
} as const

export function NoticeToast() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const shown = useRef<string | null>(null)
  const notice = params.get("notice")

  useEffect(() => {
    if (!notice || shown.current === notice || !(notice in NOTICES)) return
    shown.current = notice
    NOTICES[notice as keyof typeof NOTICES]()
    // Drop the param so a refresh doesn't repeat the toast.
    const rest = new URLSearchParams(params)
    rest.delete("notice")
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false })
  }, [notice, params, pathname, router])

  return null
}
