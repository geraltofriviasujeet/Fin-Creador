import type { NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

// Next.js 16 "proxy" (formerly middleware): session refresh + route protection.
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // Skip static assets, image optimisation and the PWA's public files (Sprint 12b: the offline
  // page, service workers, manifest, fonts, icons); run for every other page and route handler.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|offline$|sw\\.js$|sw-kill-switch\\.js$|manifest\\.webmanifest$|fonts/|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
}
