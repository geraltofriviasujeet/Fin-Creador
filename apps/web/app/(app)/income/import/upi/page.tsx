import type { Metadata } from "next"
import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { loadUpiImport } from "@fin-creador/api"
import { PageHeader } from "@/components/shell/app-shell"
import { UPI_IMPORT_ORIGINS, upiImportHref, upiImportOrigin } from "@/components/statements/upi-links"
import { UpiStatementImport } from "@/components/statements/upi-statement-import"
import { Card } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { readLlmConfig } from "@/lib/ai/config"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Import UPI statement" }

// UPI app statement import (Sprint 9e), /income/import/upi: Paytm, PhonePe, BHIM and Google Pay
// statements read in the browser (pdf.js on first use); the file and any password stay on the
// device. Accounts, categories and remembered matches are read as the signed-in user (RLS).
// ?from=income|transactions: the eyebrow and Back return there (Transactions by default).
type Params = { searchParams: Promise<{ from?: string | string[] }> }

export default function ImportUpiStatementPage({ searchParams }: Params) {
  return (
    <Suspense fallback={<ImportSkeleton />}>
      <ImportContent searchParams={searchParams} />
    </Suspense>
  )
}

async function ImportContent({ searchParams }: Params) {
  const from = upiImportOrigin((await searchParams).from)
  const origin = UPI_IMPORT_ORIGINS[from]
  const supabase = await createClient()
  const load = await loadUpiImport(supabase)
  if (!load.ok && load.reason === "unauthenticated") redirect(`/sign-in?next=${encodeURIComponent(upiImportHref(from))}`)
  const back = (
    <Link href={origin.href} className="text-sm font-semibold text-ink underline-offset-4 hover:underline">
      Back to {origin.label}
    </Link>
  )
  if (!load.ok) {
    return (
      <>
        <PageHeader eyebrow={origin.label} title="Import UPI statement" actions={back} />
        <FormMessage tone="error">We couldn&apos;t load your accounts. Check your connection and try again.</FormMessage>
      </>
    )
  }
  return (
    <>
      <PageHeader
        eyebrow={origin.label}
        title="Import UPI statement"
        description="Read a Paytm, PhonePe, BHIM or Google Pay statement PDF and choose what to save."
        actions={back}
      />
      <UpiStatementImport load={load} suggestionsOn={readLlmConfig(process.env).status === "on"} />
    </>
  )
}

function ImportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your accounts">
      <PageHeader title="Import UPI statement" />
      <Card className="grid gap-3">
        <span className="h-6 w-48 rounded bg-canvas" />
        <span className="h-10 w-full rounded-lg bg-canvas" />
      </Card>
    </div>
  )
}
