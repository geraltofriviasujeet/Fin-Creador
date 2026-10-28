import { exportTransactionsCsv } from "@fin-creador/api"
import { createClient } from "@/lib/supabase/server"

// CSV export of the signed-in user's transactions (Sprint 8c). Reads with the person's own
// session (RLS), never the service role; nothing is logged or stored. The row cap keeps an
// export to a few seconds; maxDuration is the hard stop.

export const dynamic = "force-dynamic"
export const maxDuration = 15

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const result = await exportTransactionsCsv(await createClient(), params)
  if (!result.ok) {
    return new Response(result.message, { status: result.status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } })
  }
  return new Response(result.csv, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
    },
  })
}
