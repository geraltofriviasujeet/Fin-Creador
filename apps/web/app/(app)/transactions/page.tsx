import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { loadEntry, loadTransactionPage, loadTransactionTotals, loadTransactionsContext } from "@fin-creador/api"
import { PageHeader } from "@/components/shell/app-shell"
import { FormMessage } from "@/components/ui/field"
import { periodRange, previousPeriod, readFilters, toApiFilters } from "@/components/transactions/filters"
import { TRANSACTIONS_HEADER, TransactionsSkeleton, TransactionsView } from "@/components/transactions/transactions-view"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Transactions" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// Transactions page (Sprint 3): every entry type, filtered and searched in the database
// (list_transactions, transaction_summary) as the signed-in user (RLS). Filters live in
// the URL; totals and balances are calculated in SQL and packages/domain.
export default function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<TransactionsSkeleton />}>
      <TransactionsContent searchParams={searchParams} />
    </Suspense>
  )
}

async function TransactionsContent({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams
  const params = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])))
  const query = params.toString()
  const supabase = await createClient()

  const context = await loadTransactionsContext(supabase)
  if (!context.ok && context.reason === "unauthenticated") redirect(`/sign-in?next=${encodeURIComponent(`/transactions${query ? `?${query}` : ""}`)}`)
  if (!context.ok) return <LoadError />

  const { today, currency } = context.data
  const filters = readFilters(params, today)
  const range = periodRange(filters, today)
  const prevRange = previousPeriod(filters, today)
  const deepLinkId = params.get("edit") ?? params.get("history")

  const [first, totals, prevTotals, deepLinked] = await Promise.all([
    loadTransactionPage(supabase, toApiFilters(filters, range), { currency }),
    loadTransactionTotals(supabase, toApiFilters(filters, range), currency),
    prevRange ? loadTransactionTotals(supabase, toApiFilters(filters, prevRange), currency) : null,
    deepLinkId && /^[0-9a-f-]{36}$/i.test(deepLinkId) ? loadEntry(supabase, deepLinkId) : null,
  ])
  if (!first.ok || !totals.ok || (prevTotals && !prevTotals.ok)) return <LoadError />

  // Edit only the current, unvoided version; History of any version.
  const open =
    deepLinked && params.get("edit") && !deepLinked.voided
      ? ({ kind: "edit", entry: deepLinked } as const)
      : deepLinked && params.get("history")
        ? ({ kind: "history", entry: deepLinked } as const)
        : null

  return (
    <TransactionsView
      // A different filter set or deep link starts a fresh view (pages, open dialogs).
      key={query}
      context={context.data}
      filters={filters}
      range={range}
      first={{ items: first.items, nextCursor: first.nextCursor }}
      totals={totals.totals}
      prevTotals={prevTotals?.ok ? prevTotals.totals : null}
      open={open}
    />
  )
}

function LoadError() {
  return (
    <>
      <PageHeader {...TRANSACTIONS_HEADER} />
      <FormMessage tone="error">
        We couldn&apos;t load your transactions. Check your connection.{" "}
        <a href="/transactions" className="font-semibold underline underline-offset-4">
          Try again
        </a>
      </FormMessage>
    </>
  )
}
