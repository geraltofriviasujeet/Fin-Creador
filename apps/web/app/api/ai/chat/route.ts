import { type NextRequest, NextResponse } from "next/server"
import { type Json, userToday } from "@fin-creador/api"
import { readKnowledgeConfig, readLlmConfig, readSearchConfig } from "@/lib/ai/config"
import { type BeginOutcome, type RomaDb, type RomaHistory, handleChat } from "@/lib/ai/handle"
import { type StoredTurn, fromDateRangeLiteral, toDateRangeLiteral } from "@/lib/ai/history"
import { functionEmbedder, mockEmbedder } from "@/lib/ai/knowledge/embedder"
import type { KnowledgeDb } from "@/lib/ai/knowledge/session"
import { createProvider } from "@/lib/ai/llm"
import { createSearchProvider } from "@/lib/ai/search"
import type { SearchBeginOutcome, SearchDb } from "@/lib/ai/search/session"
import { getPublicEnv } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"

// Roma (Sprint 10.1): one question, answered from the person's own records. Runs as the
// signed-in user (RLS); the caps, the kill switch and the opt-in are checked in the database
// by roma_begin_request. Signed-out callers get 401 JSON (lib/auth/routes.ts lets /api/
// through the sign-in redirect). Nothing about the question or the answer is logged; when the
// figure check refuses an answer, only the numbers it couldn't match are (10.5). From
// 10.3 the conversation's turns are read and recorded under the same session (RLS and
// roma_record_turn), never with a service key. From 10.8, with SEARCH_ENABLED, web lookups
// are offered; their credits go through roma_search_begin / _settle / _release under the same
// session, and the words a query must never carry are read here (RLS) and kept in memory.
// From 10.6c, with KNOWLEDGE_ENABLED, general questions search the knowledge base: the
// question is embedded by the embed Edge Function with the person's own access token (never a
// service key) and matched with match_knowledge_chunks under the same session.
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
        // Null starts a new conversation; generated argument types can't say a SQL argument takes null.
        p_conversation_id: turn.conversationId as string,
        p_question: turn.question,
        p_answer: turn.answer,
        p_as_of: turn.asOf,
        p_periods: turn.periods.map(toDateRangeLiteral),
        p_tools: turn.tools,
        p_sent_descriptions: turn.sentDescriptions,
        // The checked plan (10.9); the database checks its shape, size and keys again.
        ...(turn.plan ? { p_plan: turn.plan as unknown as Json } : {}),
        // The citations and tax card (10.6d), only when there are some: a database without
        // 20261114180000_roma_turn_sources.sql still records every other turn.
        ...(turn.citations ? { p_citations: turn.citations as unknown as Json } : {}),
        ...(turn.tax ? { p_tax: turn.tax as unknown as Json } : {}),
      })
      const row = Array.isArray(data) ? data[0] : null
      // A turn that couldn't be saved logs its error code and message only (the function's own
      // words, never the question, the answer or the plan).
      if (error) console.warn(JSON.stringify({ event: "roma_record_failed", code: error.code, message: error.message }))
      if (error || !row) return null
      if (!turn.plan) return { conversationId: row.conversation_id, seq: row.seq }
      // A plan's turn, read back for "Add to my goals" (owner-only, RLS); without it the plan
      // still shows, and can't be added as a goal.
      const message = await supabase.from("ai_messages").select("id").eq("conversation_id", row.conversation_id).eq("seq", row.seq).maybeSingle()
      return { conversationId: row.conversation_id, seq: row.seq, ...(message.data ? { messageId: message.data.id } : {}) }
    },
  }

  const searchDb: SearchDb = {
    async begin(requestId, provider, plan) {
      const { data, error } = await supabase.rpc("roma_search_begin", { p_request_id: requestId, p_provider: provider, p_plan: plan === true })
      const row = Array.isArray(data) ? data[0] : null
      if (error || !row) return null
      return { outcome: row.outcome as SearchBeginOutcome, credits: row.credits }
    },
    async settle(requestId, credits) {
      const { data, error } = await supabase.rpc("roma_search_settle", { p_request_id: requestId, p_credits: credits })
      return !error && data === true
    },
    async release(requestId) {
      const { data, error } = await supabase.rpc("roma_search_release", { p_request_id: requestId })
      return !error && data === true
    },
  }

  const knowledgeDb: KnowledgeDb = {
    async match(embedding, count, minSimilarity) {
      const { data, error } = await supabase.rpc("match_knowledge_chunks", {
        p_embedding: JSON.stringify(embedding),
        p_count: count,
        p_min_similarity: minSimilarity,
      })
      if (error) throw new Error(error.code ?? "match failed")
      return data
    },
  }

  const knowledgeConfig = readKnowledgeConfig(process.env)
  // The person's access token for the embed function; read from the session already checked by getUser.
  const accessToken = knowledgeConfig.status === "on" && knowledgeConfig.embedder === "supabase" ? ((await supabase.auth.getSession()).data.session?.access_token ?? "") : ""
  const searchConfig = readSearchConfig(process.env)
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
    ...(knowledgeConfig.status === "on"
      ? {
          knowledge: {
            db: knowledgeDb,
            minSimilarity: knowledgeConfig.minSimilarity,
            makeEmbedder: (requestId: string) =>
              knowledgeConfig.embedder === "mock"
                ? mockEmbedder
                : functionEmbedder({ supabaseUrl: getPublicEnv().supabaseUrl, anonKey: getPublicEnv().supabasePublishableKey, accessToken, requestId }),
          },
        }
      : {}),
    onUnverified: (unmatched) => console.warn(JSON.stringify({ event: "roma_unverified", unmatched })),
    ...(searchConfig.status === "on"
      ? {
          search: {
            db: searchDb,
            makeProvider: () => createSearchProvider(searchConfig),
            async loadTerms() {
              const [profile, accounts, categories, notes] = await Promise.all([
                supabase.from("profiles").select("display_name, country").eq("id", auth.user?.id ?? "").maybeSingle(),
                supabase.from("accounts").select("name"),
                supabase.from("categories").select("name"),
                supabase.from("transactions").select("note").not("note", "is", null).order("created_at", { ascending: false }).limit(300),
              ])
              if (profile.error || !profile.data || accounts.error || categories.error || notes.error) return null
              return {
                terms: {
                  names: [profile.data.display_name ?? "", auth.user?.email ?? ""].filter(Boolean),
                  phrases: [...accounts.data.map((a) => a.name), ...categories.data.map((c) => c.name), ...notes.data.flatMap((n) => (n.note ? [n.note] : []))],
                },
                countryCode: profile.data.country,
              }
            },
          },
        }
      : {}),
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
