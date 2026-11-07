import { z } from "zod"
import type { UserClient } from "@fin-creador/api"
import type { DateRange, IsoDate } from "@fin-creador/domain"
import type { LlmToolDef } from "../llm/types"
import type { WebSession } from "../search/session"

// Roma's finance tools are provider-independent: a Zod input schema, a description, and a
// `run` that reads with the person's own session (RLS) through existing loaders. Arithmetic
// happens in packages/domain or the database, never in the model.

export type ToolContext = {
  supabase: UserClient
  today: IsoDate
  currency: string
  /** The person agreed, in Roma, to transaction descriptions being sent (roma_descriptions_ok_at). */
  descriptionsOk: boolean
  /** This question's web lookups (10.8); absent when web lookups are off. */
  web?: WebSession
}

/** A figure a tool produced: what the answer may quote and what the figures panel shows. */
export type Figure = { label: string; hideWhenZero?: boolean } & (
  | { kind: "money"; minor: number; currency: string }
  | { kind: "count"; value: number }
  /** A rate in basis points (2,350 is 23.5%), shown with formatPercentFromBasisPoints. */
  | { kind: "percent"; bps: number }
)

/** A trip check's line about outside prices; chat.ts replaces it with what the lookups did (10.8). */
export const NO_LOOKUPS = "No outside prices were looked up."

/** A goal check (10.4): the verdict computed in code, the same said in full, and its assumptions. */
export type GoalCheck = {
  /** A trip check (10.5) labels the card "Trip check"; `goal` is then the destination. */
  kind?: "trip"
  goal: string
  /** "Yes.", "No." or "Too early to say.": the answer must start with it. */
  verdict: string
  /** The whole result in words, built in code: shown instead when the answer doesn't start with the verdict. */
  summary: string
  assumptions: string[]
  /**
   * 10.8: the same projection with only the target replaced by a web total (profile currency,
   * minor units), for the separate web-assisted line. Never changes `verdict`.
   */
  withTarget?: (targetMinor: number, costLines: readonly string[]) => WebVerdict
  /** The web-assisted verdict, when web prices were kept for this answer. */
  web?: WebVerdict
}

/** A verdict that rests on web estimates (10.8), worked out in code and always shown second. */
export type WebVerdict = { verdict: string; summary: string }

/**
 * A check that can't run until the person says more (10.5): the app shows `question`, built in
 * code, instead of the model's text, so no model prose can fail the figure check.
 */
export type InputNeeded = { tool: string; missing: string[]; question: string }

export type ToolOutput = {
  /** Sent to the model as the tool result: compact and structured, never raw rows. */
  data: Record<string, unknown>
  figures: Figure[]
  /** The period the figures cover (inclusive). */
  period?: DateRange
  /** Other dates in the result (entry and due dates): the answer may quote them. */
  dates?: IsoDate[]
  /** Descriptions matched but were left out because the person hasn't agreed to send them. */
  descriptionsWithheld?: boolean
  /** Descriptions were sent to the model (the answer may quote one; stored with the turn, 10.3). */
  descriptionsSent?: boolean
  check?: GoalCheck
  needs?: InputNeeded
  subject?: CheckSubject
  /** Web text (10.8): none of its strings are set aside as names by the figure check. */
  untrusted?: true
  /** Web prices kept and totals worked out in code (10.8), shown apart from the records. */
  web?: WebBlock
}

/** A web total for one currency (10.8): the cost lines' lowest and highest prices added up, as plain decimals. */
export type WebTotal = { currency: string; lines: number; costLines: string[]; low: string; high: string }

/** Web estimates for one answer (10.8): each price as found, with its site, and totals per currency. */
export type WebBlock = {
  figures: { label: string; amount: string; scale: string; value: string; currency: string; per: string; site: string; url: string }[]
  totals: WebTotal[]
  trip?: { nights: number; travellers: number }
}

/**
 * What a goal or trip check was about (10.5): `checked` must be something the person named in
 * the conversation, and the answer may name only the goals the tool's own result names. Either
 * failing, the answer is refused and a summary built in code is shown (chat.ts).
 */
export type CheckSubject = {
  /** The goal checked, or the trip's destination. */
  checked: string
  /** All the person's goal names (active and archived): the ones an answer could wrongly name. */
  goals: string[]
}

export type FinanceTool<I = unknown> = {
  name: string
  description: string
  input: z.ZodType<I>
  run(ctx: ToolContext, input: I): Promise<ToolOutput>
}

/** The model-facing definition: the input schema as JSON Schema. */
export function toToolDef(tool: FinanceTool): LlmToolDef {
  const { $schema: _schema, ...inputSchema } = z.toJSONSchema(tool.input) as Record<string, unknown>
  return { name: tool.name, description: tool.description, inputSchema }
}

/** A tool failure the model sees (and can say plainly); never database detail. */
export class ToolError extends Error {}
