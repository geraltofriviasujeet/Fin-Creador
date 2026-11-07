// DM Sans italic for Roma's opening line; layout.tsx loads only the upright face.
import "@fontsource-variable/dm-sans/wght-italic.css"
import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { z } from "zod"
import { PageHeader } from "@/components/shell/app-shell"
import { type OpenConversation, RomaChat } from "@/components/roma/roma-chat"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { readLlmConfig } from "@/lib/ai/config"
import { fromDateRangeLiteral } from "@/lib/ai/history"
import { ROMA_DATA_NOTICE } from "@/lib/ai/wording"
import { greeting } from "@/lib/greeting"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Roma" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** Past conversations listed beside the chat, most recent first. */
const LISTED_CONVERSATIONS = 50

export default function RomaPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader title="Roma" description="Ask about your own money. Every figure comes from your records." />
      <Suspense fallback={<RomaSkeleton />}>
        <RomaContent searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function RomaContent({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Froma")

  const { data: profile, error } = await supabase.from("profiles").select("roma_enabled, display_name, time_zone, currency").eq("id", auth.user.id).maybeSingle()
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

  // Conversations (10.3), read under RLS. ?c= opens one; an id that isn't the person's (or
  // was deleted) opens a new conversation with a notice.
  const requested = z.uuid().safeParse((await searchParams).c)
  const [list, opened] = await Promise.all([
    supabase
      .from("ai_conversations")
      .select("id, title, last_message_at")
      .order("last_message_at", { ascending: false })
      .limit(LISTED_CONVERSATIONS),
    requested.success ? loadConversation(supabase, requested.data) : Promise.resolve(null),
  ])
  if (list.error || opened === "error") {
    return (
      <FormMessage tone="error" className="max-w-2xl">
        We couldn’t load your conversations with Roma. Refresh the page to try again.
      </FormMessage>
    )
  }

  // Static text, not a model call: it costs nothing and needs no output check.
  return (
    <RomaChat
      greeting={`${greeting(profile.display_name, profile.time_zone)}.`}
      timeZone={profile.time_zone}
      currency={profile.currency}
      conversations={list.data.map((c) => ({ id: c.id, title: c.title, lastMessageAt: c.last_message_at }))}
      open={opened}
      missing={requested.success && opened === null}
    />
  )
}

type Supabase = Awaited<ReturnType<typeof createClient>>

/** A conversation's stored turns, newest first; null when it isn't the person's. */
async function loadConversation(supabase: Supabase, id: string): Promise<OpenConversation | null | "error"> {
  const [conversation, messages] = await Promise.all([
    supabase.from("ai_conversations").select("id").eq("id", id).maybeSingle(),
    supabase.from("ai_messages").select("id, seq, question, answer, as_of, periods").eq("conversation_id", id).order("seq", { ascending: false }),
  ])
  if (conversation.error || messages.error) return "error"
  if (!conversation.data) return null
  return {
    id,
    turns: messages.data.map((m) => ({
      id: m.id,
      question: m.question,
      asOf: m.as_of,
      reply: {
        status: "answer",
        answer: m.answer,
        figures: [],
        periods: (m.periods as string[]).flatMap((p) => {
          const range = fromDateRangeLiteral(p)
          return range ? [{ from: range.start, to: range.end }] : []
        }),
        conversationId: id,
        saved: true,
      },
    })),
  }
}

function RomaSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading Roma" className="grid gap-6 lg:grid-cols-[minmax(0,42rem)_16rem]">
      <Card className="grid gap-4">
        <span className="h-5 w-40 rounded bg-canvas" />
        <span className="h-20 w-full rounded-lg bg-canvas" />
      </Card>
    </div>
  )
}
