"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  type FormInput,
  type InstrumentSearch,
  type WriteResult,
  deleteFixedDeposit,
  deleteHolding,
  saveFixedDeposit,
  saveHolding,
  searchInstruments,
  setFixedDepositArchived,
  setHoldingArchived,
} from "@fin-creador/api"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

// Thin wrappers around the shared holding and fixed-deposit writers in packages/api. They run
// as the signed-in user (RLS); the shared code validates every input and the database checks
// it again.

async function client() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Finvestments")
  return supabase
}

/** Only the known fields, as strings (server actions take any value a client sends). */
function fields(input: unknown, names: readonly string[]): FormInput {
  const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
  return Object.fromEntries(names.map((n) => [n, typeof record[n] === "string" ? (record[n] as string) : ""]))
}

function refreshed<R extends { status: "success" | "error" }>(result: R): R {
  if (result.status === "success") {
    revalidatePath("/investments")
    revalidatePath("/")
  }
  return result
}

const HOLDING_FIELDS = ["holdingId", "instrumentId", "units", "buyPrice", "buyDate", "idempotencyKey"] as const

export async function saveHoldingAction(input: unknown): Promise<WriteResult> {
  return refreshed(await saveHolding(await client(), fields(input, HOLDING_FIELDS)))
}

const holdingRef = z.object({ holdingId: z.uuid(), archived: z.boolean() })

export async function setHoldingArchivedAction(input: unknown): Promise<WriteResult> {
  const r = holdingRef.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that holding." }
  return refreshed(await setHoldingArchived(await client(), r.data))
}

const holdingId = z.object({ holdingId: z.uuid() })

/** Permanent delete of an archived record (the database refuses any other). */
export async function deleteHoldingAction(input: unknown): Promise<WriteResult> {
  const r = holdingId.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that holding." }
  return refreshed(await deleteHolding(await client(), r.data))
}

/** Instrument search for the Add holding dialog (read-only; shared instruments). */
export async function searchInstrumentsAction(query: unknown): Promise<InstrumentSearch> {
  return searchInstruments(await client(), typeof query === "string" ? query : "")
}

const DEPOSIT_FIELDS = ["depositId", "bank", "label", "principal", "rate", "compounding", "startDate", "maturityDate", "idempotencyKey"] as const

export async function saveFixedDepositAction(input: unknown): Promise<WriteResult> {
  return refreshed(await saveFixedDeposit(await client(), fields(input, DEPOSIT_FIELDS)))
}

const depositRef = z.object({ depositId: z.uuid(), archived: z.boolean() })

export async function setFixedDepositArchivedAction(input: unknown): Promise<WriteResult> {
  const r = depositRef.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that fixed deposit." }
  return refreshed(await setFixedDepositArchived(await client(), r.data))
}

const depositId = z.object({ depositId: z.uuid() })

/** Permanent delete of an archived deposit (the database refuses any other). */
export async function deleteFixedDepositAction(input: unknown): Promise<WriteResult> {
  const r = depositId.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that fixed deposit." }
  return refreshed(await deleteFixedDeposit(await client(), r.data))
}
