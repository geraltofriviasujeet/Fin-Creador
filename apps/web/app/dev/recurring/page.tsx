import type { Metadata } from "next"
import { Suspense } from "react"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { localDateInTimeZone } from "@fin-creador/domain"
import { AppShell } from "@/components/shell/app-shell"
import { RecurringPrototype } from "./_prototype/recurring-prototype"

export const metadata: Metadata = { title: "Recurring prototype", robots: { index: false, follow: false } }

// Sprint 4 Phase 1: clickable prototype of recurring items on in-memory DEMO data. No
// Supabase reads or writes. Development only: 404 in production builds, and open without a
// session in `next dev` (lib/auth/routes.ts) so it can be reviewed. Removed in Phase 2.
const DEMO_TIME_ZONE = "Asia/Kolkata"

export default function RecurringPrototypePage() {
  if (process.env.NODE_ENV === "production") notFound()
  return (
    <AppShell user={{ name: "Demo user", email: "demo@example.test" }}>
      <Suspense fallback={null}>
        <PrototypeContent />
      </Suspense>
    </AppShell>
  )
}

async function PrototypeContent() {
  await connection() // render per request: "today" must not be frozen at build time
  // Demo only: the real pages take "today" from the database (user_local_today).
  return <RecurringPrototype today={localDateInTimeZone(new Date(), DEMO_TIME_ZONE)} />
}
