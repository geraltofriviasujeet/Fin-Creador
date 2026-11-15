// DM Sans italic for Roma's opening line; layout.tsx loads only the upright face.
import "@fontsource-variable/dm-sans/wght-italic.css"
import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { z } from "zod"
import { Sparkles } from "lucide-react"
import { type OpenConversation, RomaChat } from "@/components/roma/roma-chat"
import type { ConversationKind } from "@/components/roma/roma-history"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { readKnowledgeConfig, readLlmConfig } from "@/lib/ai/config"
import { answerBasis, fromDateRangeLiteral } from "@/lib/ai/history"
import { ROMA_DATA_NOTICE } from "@/lib/ai/wording"
import { greeting } from "@/lib/greeting"
import type { Database } from "@fin-creador/api"
import { createClient } from "@/lib/supabase/server"
import { checkedPlanSchema } from "@/lib/ai/plan/types"
import { shownCitations, shownTax } from "@/lib/ai/stored-sources"

export const metadata: Metadata = { title: "Roma" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** Past conversations listed beside the chat, most recent first. */
const LISTED_CONVERSATIONS = 50

export default function RomaPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <>
          <RomaHeader />
          <RomaSkeleton />
        </>
      }
    >
      <RomaContent searchParams={searchParams} />
    </Suspense>
  )
}

async function RomaContent({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Froma")

  const { data: profile, error } = await supabase.from("profiles").select("roma_enabled, display_name, time_zone, currency").eq("id", auth.user.id).maybeSingle()
  if (error || !profile) {
    return (
      <>
        <RomaHeader />
        <FormMessage tone="error" className="max-w-2xl">
          We couldn’t load Roma. Refresh the page to try again.
        </FormMessage>
      </>
    )
  }

  if (!profile.roma_enabled) {
    return (
      <>
        <RomaHeader status="off" />
        <Card className="max-w-2xl">
          <CardTitle>Roma is off</CardTitle>
          <CardDescription className="mt-1">{ROMA_DATA_NOTICE}</CardDescription>
          <Link href="/settings" className={buttonVariants({ className: "mt-4" })}>
            Turn Roma on in Settings
          </Link>
        </Card>
      </>
    )
  }

  // The kill switch and caps are checked per question; this only says when Roma isn't set up.
  if (readLlmConfig(process.env).status !== "on") {
    return (
      <>
        <RomaHeader status="off" />
        <Card className="max-w-2xl">
          <CardTitle>Roma is off right now</CardTitle>
          <CardDescription className="mt-1">Roma isn’t available at the moment. Your records are unaffected.</CardDescription>
        </Card>
      </>
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
    requested.success ? loadConversation(supabase, requested.data, profile.time_zone) : Promise.resolve(null),
  ])
  if (list.error || opened === "error") {
    return (
      <>
        <RomaHeader />
        <FormMessage tone="error" className="max-w-2xl">
          We couldn’t load your conversations with Roma. Refresh the page to try again.
        </FormMessage>
      </>
    )
  }

  // Which listed conversations hold a plan, and of what kind, for the list's type marker. Only
  // the plan's kind is read, never the plan; a failed read only shows them as questions.
  const ids = list.data.map((c) => c.id)
  const plans = ids.length > 0 ? await supabase.from("ai_messages").select("conversation_id, kind:plan->>kind").not("plan", "is", null).in("conversation_id", ids) : null
  const kindOf = (id: string): ConversationKind => {
    const kind = plans?.data?.find((m) => m.conversation_id === id)?.kind
    return kind === "trip" || kind === "purchase" ? kind : "question"
  }

  // Static text, not a model call: it costs nothing and needs no output check.
  return (
    <>
      <RomaHeader status="ready" />
      <RomaChat
        greeting={`${greeting(profile.display_name, profile.time_zone)}.`}
        timeZone={profile.time_zone}
        currency={profile.currency}
        conversations={list.data.map((c) => ({ id: c.id, title: c.title, lastMessageAt: c.last_message_at, kind: kindOf(c.id) }))}
        open={opened}
        missing={requested.success && opened === null}
        knowledge={readKnowledgeConfig(process.env).status === "on"}
      />
    </>
  )
}

type Supabase = Awaited<ReturnType<typeof createClient>>
type Message = Pick<Database["public"]["Tables"]["ai_messages"]["Row"], "id" | "seq" | "question" | "answer" | "as_of" | "periods" | "tools" | "plan" | "citations" | "tax">

/** A conversation's stored turns, newest first; null when it isn't the person's. */
async function loadConversation(supabase: Supabase, id: string, timeZone: string): Promise<OpenConversation | null | "error"> {
  const read = (columns: string) => supabase.from("ai_messages").select(columns).eq("conversation_id", id).order("seq", { ascending: false })
  const [conversation, withSources] = await Promise.all([
    supabase.from("ai_conversations").select("id").eq("id", id).maybeSingle(),
    read("id, seq, question, answer, as_of, periods, tools, plan, citations, tax").returns<Message[]>(),
  ])
  // A database without 20261114180000_roma_turn_sources.sql (42703: no such column) still
  // opens the conversation, without stored sources.
  const messages =
    withSources.error?.code === "42703"
      ? await read("id, seq, question, answer, as_of, periods, tools, plan").returns<Omit<Message, "citations" | "tax">[]>().then((r) => ({ ...r, data: r.data?.map((m) => ({ ...m, citations: null, tax: null })) ?? null }))
      : withSources
  if (conversation.error || messages.error || !messages.data) return "error"
  if (!conversation.data) return null
  const rows = messages.data
  // Goals added from this conversation's plans; a failed read only hides the link.
  const planIds = rows.filter((m) => m.plan !== null).map((m) => m.id)
  const linked = planIds.length > 0 ? await supabase.from("goals").select("id, name, plan_message_id").in("plan_message_id", planIds) : null
  const goalOf = (messageId: string) => {
    const g = linked?.data?.find((x) => x.plan_message_id === messageId)
    return g ? { id: g.id, name: g.name } : null
  }
  // The out-of-date notices are worked out as of the person's today now, not when answered.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  return {
    id,
    turns: rows.map((m) => ({
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
        basis: answerBasis(m.tools),
        // A stored plan (10.9) is read back like any stored data: shown only if it still parses.
        ...(() => {
          const plan = m.plan === null ? null : checkedPlanSchema.safeParse(m.plan)
          return plan?.success ? { plan: plan.data, planLink: { messageId: m.id, goal: goalOf(m.id) } } : {}
        })(),
        // Stored citations and the tax card (10.6d), the same way.
        ...(() => {
          const citations = m.citations === null ? null : shownCitations(m.citations, today)
          const tax = m.tax === null ? null : shownTax(m.tax, today)
          return { ...(citations ? { citations } : {}), ...(tax ? { tax } : {}) }
        })(),
        conversationId: id,
        saved: true,
      },
    })),
  }
}

/**
 * The page's header (docs/design/roma, 2026-11-09): Roma's mark, "Ask Roma", whether she is
 * ready (on and set up) or off, and what she is. No chip while loading or after an error.
 */
function RomaHeader({ status }: { status?: "ready" | "off" }) {
  return (
    <div className="mb-5 flex items-center gap-3 md:mb-6 md:gap-4">
      <span aria-hidden="true" className="on-dark grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-deep text-brand md:size-12">
        <Sparkles className="size-5" />
      </span>
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-(--fc-tracking-heading) md:text-3xl">Ask Roma</h1>
          {status && (
            <Badge tone={status === "ready" ? "positive" : "neutral"} data-testid="roma-status">
              <span aria-hidden="true" className={`size-1.5 rounded-full ${status === "ready" ? "bg-success" : "bg-muted-foreground"}`} />
              {status === "ready" ? "Ready" : "Off"}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">Your intelligent finance analyst, grounded in your records.</p>
      </div>
    </div>
  )
}

function RomaSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading Roma" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <Card className="grid gap-4">
        <span className="h-5 w-40 rounded bg-canvas" />
        <span className="h-20 w-full rounded-lg bg-canvas" />
      </Card>
    </div>
  )
}
