import { z } from "zod"
import type { UserClient } from "@fin-creador/api"
import type { DateRange, IsoDate } from "@fin-creador/domain"
import type { LlmToolDef } from "../llm/types"

// Roma's finance tools are provider-independent: a Zod input schema, a description, and a
// `run` that reads with the person's own session (RLS) through existing loaders. Arithmetic
// happens in packages/domain or the database, never in the model.

export type ToolContext = { supabase: UserClient; today: IsoDate; currency: string }

/** A figure a tool produced: what the answer may quote and what the figures panel shows. */
export type Figure = { label: string; hideWhenZero?: boolean } & (
  | { kind: "money"; minor: number; currency: string }
  | { kind: "count"; value: number }
)

export type ToolOutput = {
  /** Sent to the model as the tool result: compact and structured, never raw rows. */
  data: Record<string, unknown>
  figures: Figure[]
  /** The period the figures cover (inclusive). */
  period?: DateRange
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
