import { type NextRequest, NextResponse } from "next/server"
import { buildRecurringView, loadBellReminders, loadRecurringData, loadTransactionPage, loadTransactionTotals, loadTransactionsContext } from "@fin-creador/api"
import { monthRange } from "@fin-creador/domain"
import { buildOfflineSnapshot } from "@/lib/pwa/build-snapshot"
import { SNAPSHOT_LIMITS } from "@/lib/pwa/snapshot"
import { createClient } from "@/lib/supabase/server"

// The offline snapshot (Sprint 12b, lib/pwa/snapshot.ts) for the signed-in user: read under RLS
// with the person's own session, built by buildOfflineSnapshot. Never cached anywhere: no-store
// here, and the service worker never caches /api/. Signed-out callers get 401 JSON
// (lib/auth/routes.ts lets /api/ through). Same-origin only.

const NO_STORE = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" }

/** The earliest date the latest-entries list looks back to (as the Overview's Recent list). */
const ALL_TIME_START = "1900-01-01"

export async function GET(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site")
  if (site && site !== "same-origin") return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE })

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE })

  const context = await loadTransactionsContext(supabase)
  if (!context.ok) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE })
  const { today, currency } = context.data
  const month = monthRange(today)

  const [totals, recent, recurring, reminders] = await Promise.all([
    loadTransactionTotals(supabase, { from: month.start, to: month.end }, currency),
    loadTransactionPage(supabase, { from: ALL_TIME_START, to: today }, { currency, limit: SNAPSHOT_LIMITS.entries }),
    loadRecurringData(supabase),
    loadBellReminders(supabase).catch(() => null),
  ])
  if (!totals.ok || !recent.ok) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE })

  const snapshot = buildOfflineSnapshot({
    userId: auth.user.id,
    now: new Date(),
    context: context.data,
    month: totals.totals,
    recent: recent.items,
    recurring: recurring.ok ? buildRecurringView({ ...recurring.data, ...context.data }) : null,
    reminders,
  })
  return NextResponse.json(snapshot, { headers: NO_STORE })
}
