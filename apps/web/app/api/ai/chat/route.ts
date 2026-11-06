import { type NextRequest, NextResponse } from "next/server"
import { userToday } from "@fin-creador/api"
import { readLlmConfig } from "@/lib/ai/config"
import { type BeginOutcome, type RomaDb, type RomaHistory, handleChat } from "@/lib/ai/handle"
import { type StoredTurn, fromDateRangeLiteral, toDateRangeLiteral } from "@/lib/ai/history"
import { createProvider } from "@/lib/ai/llm"
import { createClient } from "@/lib/supabase/server"

// Roma (Sprint 10.1): one question, answered from the person's own records. Runs as the
// signed-in user (RLS); the caps, the kill switch and the opt-in are checked in the database
// by roma_begin_request. Signed-out callers get 401 JSON (lib/auth/routes.ts lets /api/
// through the sign-in redirect). Nothing about the question or the answer is logged. From
// 10.3 the conversation's turns are read and recorded under the same session (RLS and
// roma_record_turn), never with a service key.
//
// maxDuration is the hard stop; the chat loop's own 45 s deadline (lib/ai/chat.ts) ends a
// slow answer first with a clear message. Vercel Hobby allows up to 300 s.

export const maxDuration = 60

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()

  // Same-site requests only (cookies carry the session): another site can't spend the budget.
  if (auth.user && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ status: "error", code: "forbidden", message: "Not allowed." }, { status: 403, headers: NO_STORE })
  }

  const db: RomaDb = {
    async begin(provider, model) {
      const { data, error } = await supabase.rpc("roma_begin_request", { p_provider: provider, p_model: model })
      const row = Array.isArray(data) ? data[0] : null
      if (error || !row) return null
      return { outcome: row.outcome as BeginOutcome, requestId: row.request_id }
    },
    async settle(requestId, inputTokens, outputTokens, costUsd) {
      const { data, error } = await supabase.rpc("roma_settle_request", {
        p_request_id: requestId,
        p_input_tokens: inputTokens,
        p_output_tokens: outputTokens,
        p_cost_usd: costUsd,
      })
      return !error && data === true
    },
    async release(requestId) {
      const { data, error } = await supabase.rpc("roma_release_request", { p_request_id: requestId })
      return !error && data === true
    },
  }

  const history: RomaHistory = {
    async load(conversationId) {
      const [conversation, messages] = await Promise.all([
        supabase.from("ai_conversations").select("id").eq("id", conversationId).maybeSingle(),
        supabase
          .from("ai_messages")
          .select("seq, question, answer, as_of, periods, tools, sent_descriptions")
          .eq("conversation_id", conversationId)
          .order("seq"),
      ])
      if (conversation.error || messages.error) return null
      if (!conversation.data) return "missing"
      return messages.data.map(
        (m): StoredTurn => ({
          seq: m.seq,
          question: m.question,
          answer: m.answer,
          asOf: m.as_of,
          periods: (m.periods as string[]).flatMap((p) => fromDateRangeLiteral(p) ?? []),
          tools: m.tools,
          sentDescriptions: m.sent_descriptions,
        }),
      )
    },
    async record(turn) {
      const { data, error } = await supabase.rpc("roma_record_turn", {
        p_request_id: turn.requestId,
        p_conversation_id: turn.conversationId,
        p_question: turn.question,
        p_answer: turn.answer,
        p_as_of: turn.asOf,
        p_periods: turn.periods.map(toDateRangeLiteral),
        p_tools: turn.tools,
        p_sent_descriptions: turn.sentDescriptions,
      })
      const row = Array.isArray(data) ? data[0] : null
      if (error || !row) return null
      return { conversationId: row.conversation_id, seq: row.seq }
    },
  }

  const config = readLlmConfig(process.env)
  const result = await handleChat(await request.json().catch(() => null), {
    signedIn: Boolean(auth.user),
    config,
    db,
    history,
    makeProvider: () => {
      if (config.status !== "on") throw new Error("Roma is off")
      return createProvider(config)
    },
    async loadContext() {
      const [today, profile] = await Promise.all([
        userToday(supabase),
        supabase.from("profiles").select("currency, roma_descriptions_ok_at").eq("id", auth.user?.id ?? "").maybeSingle(),
      ])
      if (!today.ok || profile.error || !profile.data) return null
      return { supabase, today: today.today, currency: profile.data.currency, descriptionsOk: profile.data.roma_descriptions_ok_at !== null }
    },
  })
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
}
