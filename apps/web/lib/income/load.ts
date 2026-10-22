import "server-only"
import { redirect } from "next/navigation"
import { loadIncomeData } from "@fin-creador/api"
import type { IncomePageData } from "@/lib/income/types"
import { createClient } from "@/lib/supabase/server"

/** The Income page's data, via the loader shared with the mobile app (RLS applies). */
export async function loadIncomePage(): Promise<{ ok: true; data: IncomePageData } | { ok: false }> {
  const result = await loadIncomeData(await createClient())
  if (!result.ok && result.reason === "unauthenticated") redirect("/sign-in?next=%2Fincome")
  return result.ok ? result : { ok: false }
}
