"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  type FormInput,
  type LoanWriteResult,
  type PaymentWriteResult,
  type WriteResult,
  addLoan,
  clearDuePlan,
  deleteLoan,
  editDuePayment,
  editLoan,
  payDueItem,
  planDueItem,
  setLoanArchived,
  voidDuePayment,
} from "@fin-creador/api"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

// Thin wrappers around the shared loan writers in packages/api. They run as the signed-in user
// (RLS); the shared code validates every input and the database checks it again.

const PATH = "/loans-liabilities"

async function client() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect(`/sign-in?next=${encodeURIComponent(PATH)}`)
  return supabase
}

/** Only the known fields, as strings (server actions take any value a client sends). */
function fields(input: unknown, names: readonly string[]): FormInput {
  const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
  return Object.fromEntries(names.map((n) => [n, typeof record[n] === "string" ? (record[n] as string) : ""]))
}

function refreshed<R extends { status: "success" | "error" }>(result: R): R {
  if (result.status === "success") {
    revalidatePath(PATH)
    revalidatePath("/")
    revalidatePath("/transactions")
    revalidatePath("/income")
  }
  return result
}

const LOAN_FIELDS = [
  "loanType", "typeOther", "lender", "nickname", "sanctioned", "disbursed", "rate", "rateKind", "tenureMonths", "startMode",
  "outstanding", "remainingMonths", "nextDueDate", "thisMonthPaid", "firstEmiDate", "moratoriumMonths", "moratoriumInterest", "emi", "idempotencyKey",
] as const

export async function addLoanAction(input: unknown): Promise<LoanWriteResult> {
  return refreshed(await addLoan(await client(), fields(input, LOAN_FIELDS)))
}

const EDIT_FIELDS = ["loanId", "loanType", "typeOther", "lender", "nickname", "sanctioned", "rate", "rateKind", "emi"] as const

export async function editLoanAction(input: unknown): Promise<LoanWriteResult> {
  return refreshed(await editLoan(await client(), fields(input, EDIT_FIELDS)))
}

const loanRef = z.object({ loanId: z.uuid(), archived: z.boolean() })

export async function setLoanArchivedAction(input: unknown): Promise<WriteResult> {
  const r = loanRef.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that loan." }
  return refreshed(await setLoanArchived(await client(), r.data))
}

const loanId = z.object({ loanId: z.uuid() })

/** Permanent delete of an archived loan with no payments (the database refuses any other). */
export async function deleteLoanAction(input: unknown): Promise<WriteResult> {
  const r = loanId.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that loan." }
  return refreshed(await deleteLoan(await client(), r.data))
}

const PAY_FIELDS = ["dueItemId", "accountId", "paidOn", "principal", "interest", "fees", "allowShortfall", "idempotencyKey"] as const

export async function payDueItemAction(input: unknown): Promise<PaymentWriteResult> {
  return refreshed(await payDueItem(await client(), fields(input, PAY_FIELDS)))
}

export async function editDuePaymentAction(input: unknown): Promise<PaymentWriteResult> {
  return refreshed(await editDuePayment(await client(), fields(input, ["paymentId", ...PAY_FIELDS])))
}

const voidInput = z.object({ paymentId: z.uuid(), idempotencyKey: z.uuid(), reason: z.string().max(200).optional() })

export async function voidDuePaymentAction(input: unknown): Promise<PaymentWriteResult> {
  const r = voidInput.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that payment." }
  return refreshed(await voidDuePayment(await client(), r.data))
}

export async function planDueItemAction(input: unknown): Promise<WriteResult> {
  return refreshed(await planDueItem(await client(), fields(input, ["dueItemId", "accountId", "plannedOn"])))
}

const dueRef = z.object({ dueItemId: z.uuid() })

export async function clearDuePlanAction(input: unknown): Promise<WriteResult> {
  const r = dueRef.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that EMI." }
  return refreshed(await clearDuePlan(await client(), r.data))
}
