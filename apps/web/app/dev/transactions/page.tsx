import type { Metadata } from "next"
import { Suspense } from "react"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { localDateInTimeZone } from "@fin-creador/domain"
import { AppShell } from "@/components/shell/app-shell"
import { TransactionsPrototype, TransactionsSkeleton } from "./_prototype/transactions-prototype"

export const metadata: Metadata = { title: "Transactions prototype", robots: { index: false, follow: false } }

// Sprint 3 Phase 1: clickable prototype of the Transactions page on in-memory DEMO data.
// No Supabase reads or writes. Development only: 404 in production builds, and the only
// page outside the signed-in group (lib/auth/routes.ts), so it can be reviewed without an
// account. The real page (Phase 2) lives at /transactions and loads as the signed-in user.
const DEMO_TIME_ZONE = "Asia/Kolkata"

export default function TransactionsPrototypePage() {
  if (process.env.NODE_ENV === "production") notFound()

  return (
    <AppShell
      user={{ name: "Demo user", email: "demo@example.test" }}
      navPreview={{ transactions: "/dev/transactions" }}
      topbarRoutes={{ addHref: "/dev/transactions?add=expense", searchPath: "/dev/transactions" }}
    >
      <Suspense fallback={<TransactionsSkeleton />}>
        <PrototypeContent />
      </Suspense>
    </AppShell>
  )
}

async function PrototypeContent() {
  await connection() // render per request: "today" must not be frozen at build time
  // Demo only: the real page takes "today" from the database (user_local_today).
  const today = localDateInTimeZone(new Date(), DEMO_TIME_ZONE)
  return <TransactionsPrototype today={today} />
}
