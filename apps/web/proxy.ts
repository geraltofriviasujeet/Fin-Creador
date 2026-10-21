import type { NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

// Next.js 16 "proxy" (formerly middleware): session refresh + route protection.
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // Skip static assets and image optimisation; run for every page and route handler.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
}
