import "@fontsource-variable/lora/wght-italic.css"
import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { PageHeader } from "@/components/shell/app-shell"
import { RomaChat } from "@/components/roma/roma-chat"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { readLlmConfig } from "@/lib/ai/config"
import { ROMA_DATA_NOTICE } from "@/lib/ai/wording"
import { greeting } from "@/lib/greeting"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Roma" }

export default function RomaPage() {
  return (
    <>
      <PageHeader title="Roma" description="Ask about your own money. Every figure comes from your records." />
      <Suspense fallback={<RomaSkeleton />}>
        <RomaContent />
      </Suspense>
    </>
  )
}

async function RomaContent() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Froma")

  const { data: profile, error } = await supabase.from("profiles").select("roma_enabled, display_name, time_zone").eq("id", auth.user.id).maybeSingle()
  if (error || !profile) {
    return (
      <FormMessage tone="error" className="max-w-2xl">
        We couldn’t load Roma. Refresh the page to try again.
      </FormMessage>
    )
  }

  if (!profile.roma_enabled) {
    return (
      <Card className="max-w-2xl">
        <CardTitle>Roma is off</CardTitle>
        <CardDescription className="mt-1">{ROMA_DATA_NOTICE}</CardDescription>
        <Link href="/settings" className={buttonVariants({ className: "mt-4" })}>
          Turn Roma on in Settings
        </Link>
      </Card>
    )
  }

  // The kill switch and caps are checked per question; this only says when Roma isn't set up.
  if (readLlmConfig(process.env).status !== "on") {
    return (
      <Card className="max-w-2xl">
        <CardTitle>Roma is off right now</CardTitle>
        <CardDescription className="mt-1">Roma isn’t available at the moment. Your records are unaffected.</CardDescription>
      </Card>
    )
  }

  // Static text, not a model call: it costs nothing and needs no output check.
  return <RomaChat greeting={`${greeting(profile.display_name, profile.time_zone)}.`} />
}

function RomaSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading Roma" className="grid max-w-2xl gap-4">
      <Card className="grid gap-4">
        <span className="h-5 w-40 rounded bg-canvas" />
        <span className="h-20 w-full rounded-lg bg-canvas" />
      </Card>
    </div>
  )
}
