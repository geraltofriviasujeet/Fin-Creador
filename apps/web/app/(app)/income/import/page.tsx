import type { Metadata } from "next"
import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { loadImportAccount } from "@fin-creador/api"
import { PageHeader } from "@/components/shell/app-shell"
import { BankStatementImport } from "@/components/statements/bank-statement-import"
import { Card } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Import bank statement" }

const importPath = (accountId: string) => `/income/import?account=${encodeURIComponent(accountId)}`

// Bank statement import (Sprint 9b), /income/import?account=<id>: the PDF is read in the browser
// (pdf.js loads only on this page, on first use). The account is read as the signed-in user (RLS):
// another person's account id, or one that isn't a bank account, shows "not found".
export default function ImportBankStatementPage({ searchParams }: { searchParams: Promise<{ account?: string | string[] }> }) {
  return (
    <Suspense fallback={<ImportSkeleton />}>
      <ImportContent searchParams={searchParams} />
    </Suspense>
  )
}

async function ImportContent({ searchParams }: { searchParams: Promise<{ account?: string | string[] }> }) {
  const { account } = await searchParams
  const accountId = typeof account === "string" ? account : ""
  const supabase = await createClient()
  const load = await loadImportAccount(supabase, accountId)
  if (!load.ok && load.reason === "unauthenticated") redirect(`/sign-in?next=${encodeURIComponent(importPath(accountId))}`)
  const back = (
    <Link href="/income" className="text-sm font-semibold text-ink underline-offset-4 hover:underline">
      Back to Income
    </Link>
  )
  if (!load.ok) {
    return (
      <>
        <PageHeader eyebrow="Bank account" title="Import statement" actions={back} />
        <FormMessage tone="error">
          {load.reason === "not_found" ? "We couldn't find this bank account. It may be archived." : "We couldn't load this account. Check your connection and try again."}
        </FormMessage>
      </>
    )
  }
  return (
    <>
      <PageHeader eyebrow={load.account.name} title="Import statement" description="Read your bank statement PDF and choose what each line is." actions={back} />
      {/* Keyed by account: another account's import starts with no file, review or choices. */}
      <BankStatementImport key={load.account.id} account={load.account} today={load.today} options={load.options} />
    </>
  )
}

function ImportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the account">
      <PageHeader eyebrow="Bank account" title="Import statement" />
      <Card className="grid gap-3">
        <span className="h-6 w-48 rounded bg-canvas" />
        <span className="h-10 w-full rounded-lg bg-canvas" />
      </Card>
    </div>
  )
}
