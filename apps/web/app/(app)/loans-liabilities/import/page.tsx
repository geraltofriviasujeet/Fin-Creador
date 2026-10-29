import type { Metadata } from "next"
import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { loadImportCard } from "@fin-creador/api"
import { LOANS_PATH } from "@/components/loans/display"
import { PageHeader } from "@/components/shell/app-shell"
import { StatementImport } from "@/components/statements/statement-import"
import { Card } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Import card statement" }

const importPath = (cardId: string) => `${LOANS_PATH}/import?card=${encodeURIComponent(cardId)}`

// Card statement import (Sprint 9a), /loans-liabilities/import?card=<id>: the PDF is read in the browser (pdf.js loads only on this
// page, on first use). The card is read as the signed-in user (RLS): another person's card id
// shows "not found".
export default function ImportStatementPage({ searchParams }: { searchParams: Promise<{ card?: string | string[] }> }) {
  return (
    <Suspense fallback={<ImportSkeleton />}>
      <ImportContent searchParams={searchParams} />
    </Suspense>
  )
}

async function ImportContent({ searchParams }: { searchParams: Promise<{ card?: string | string[] }> }) {
  const { card } = await searchParams
  const cardId = typeof card === "string" ? card : ""
  const supabase = await createClient()
  const load = await loadImportCard(supabase, cardId)
  if (!load.ok && load.reason === "unauthenticated") redirect(`/sign-in?next=${encodeURIComponent(importPath(cardId))}`)
  const back = (
    <Link href={LOANS_PATH} className="text-sm font-semibold text-ink underline-offset-4 hover:underline">
      Back to Loans &amp; Liabilities
    </Link>
  )
  if (!load.ok) {
    return (
      <>
        <PageHeader eyebrow="Credit card" title="Import statement" actions={back} />
        <FormMessage tone="error">
          {load.reason === "not_found" ? "We couldn't find this card. It may be archived." : "We couldn't load this card. Check your connection and try again."}
        </FormMessage>
      </>
    )
  }
  return (
    <>
      <PageHeader eyebrow={load.card.name} title="Import statement" description="Read your card statement PDF and check the lines." actions={back} />
      <StatementImport card={load.card} today={load.today} categories={load.categories} />
    </>
  )
}

function ImportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the card">
      <PageHeader eyebrow="Credit card" title="Import statement" />
      <Card className="grid gap-3">
        <span className="h-6 w-48 rounded bg-canvas" />
        <span className="h-10 w-full rounded-lg bg-canvas" />
      </Card>
    </div>
  )
}
