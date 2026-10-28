"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  type CardWriteResult,
  type FormInput,
  type LoanWriteResult,
  type PaymentWriteResult,
  type WriteResult,
  addBorrowing,
  addCard,
  addLoan,
  clearDuePlan,
  deleteBorrowing,
  deleteCard,
  deleteStatement,
  editBorrowing,
  editCard,
  editLiabilityPayment,
  enterStatement,
  linkCardEmi,
  payCard,
  repayBorrowing,
  setBorrowingArchived,
  setBorrowingReturnPlan,
  setCardArchived,
  voidLiabilityPayment,
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

// Thin wrappers around the shared loan, card and borrowing writers in packages/api. They run as the signed-in user
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

// ---------------------------------------------------------------------------
// Cards, statements and borrowing (8b)
// ---------------------------------------------------------------------------

const CARD_FIELDS = ["issuer", "product", "productOther", "nickname", "limit", "statementDay", "dueDay", "openingOwed", "idempotencyKey"] as const

export async function addCardAction(input: unknown): Promise<CardWriteResult> {
  return refreshed(await addCard(await client(), fields(input, CARD_FIELDS)))
}

export async function editCardAction(input: unknown): Promise<CardWriteResult> {
  return refreshed(await editCard(await client(), fields(input, ["cardId", "issuer", "product", "productOther", "nickname", "limit", "statementDay", "dueDay"])))
}

const cardRef = z.object({ cardId: z.uuid(), archived: z.boolean(), currency: z.string().regex(/^[A-Z]{3}$/).optional() })

export async function setCardArchivedAction(input: unknown): Promise<WriteResult> {
  const r = cardRef.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that card." }
  return refreshed(await setCardArchived(await client(), r.data))
}

const cardId = z.object({ cardId: z.uuid() })

export async function deleteCardAction(input: unknown): Promise<WriteResult> {
  const r = cardId.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that card." }
  return refreshed(await deleteCard(await client(), r.data))
}

const linkInput = z.object({ loanId: z.uuid(), cardId: z.uuid().nullable() })

export async function linkCardEmiAction(input: unknown): Promise<WriteResult> {
  const r = linkInput.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that EMI." }
  return refreshed(await linkCardEmi(await client(), r.data))
}

const STATEMENT_FIELDS = ["cardId", "statementDate", "dueDate", "total", "minimum", "emiIncluded", "differenceCategoryId", "idempotencyKey"] as const

export async function enterStatementAction(input: unknown): Promise<CardWriteResult> {
  return refreshed(await enterStatement(await client(), fields(input, STATEMENT_FIELDS)))
}

const statementId = z.object({ statementId: z.uuid() })

export async function deleteStatementAction(input: unknown): Promise<WriteResult> {
  const r = statementId.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that statement." }
  return refreshed(await deleteStatement(await client(), r.data))
}

export async function payCardAction(input: unknown): Promise<CardWriteResult> {
  return refreshed(await payCard(await client(), fields(input, ["cardId", "accountId", "paidOn", "amount", "allowShortfall", "idempotencyKey"])))
}

const LIABILITY_PAY_FIELDS = ["paymentId", "accountId", "paidOn", "amount", "principal", "interest", "allowShortfall", "idempotencyKey"] as const

export async function editLiabilityPaymentAction(input: unknown): Promise<CardWriteResult> {
  return refreshed(await editLiabilityPayment(await client(), fields(input, LIABILITY_PAY_FIELDS)))
}

const voidLiability = z.object({
  paymentId: z.uuid(),
  idempotencyKey: z.uuid(),
  reason: z.string().max(200).optional(),
  subject: z.enum(["card", "borrowing"]).optional(),
})

export async function voidLiabilityPaymentAction(input: unknown): Promise<WriteResult> {
  const r = voidLiability.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that payment." }
  return refreshed(await voidLiabilityPayment(await client(), r.data))
}

const RETURN_PLAN_FIELDS = ["sameAsBorrowed", "amountToReturn", "returnOn", "returnPlan", "instalments", "payFromAccountId"] as const
const BORROWING_FIELDS = ["lender", "relationship", "reason", "amount", "received", "accountId", "receivedOn", ...RETURN_PLAN_FIELDS, "idempotencyKey"] as const

export async function addBorrowingAction(input: unknown): Promise<CardWriteResult> {
  return refreshed(await addBorrowing(await client(), fields(input, BORROWING_FIELDS)))
}

export async function repayBorrowingAction(input: unknown): Promise<CardWriteResult> {
  return refreshed(await repayBorrowing(await client(), fields(input, ["borrowingId", "accountId", "paidOn", "principal", "interest", "allowShortfall", "idempotencyKey"])))
}

export async function editBorrowingAction(input: unknown): Promise<CardWriteResult> {
  return refreshed(await editBorrowing(await client(), fields(input, ["borrowingId", "lender", "relationship", "reason"])))
}

export async function setBorrowingReturnPlanAction(input: unknown): Promise<WriteResult> {
  return refreshed(await setBorrowingReturnPlan(await client(), fields(input, ["borrowingId", ...RETURN_PLAN_FIELDS])))
}

const borrowingRef = z.object({ borrowingId: z.uuid(), archived: z.boolean(), currency: z.string().regex(/^[A-Z]{3}$/).optional() })

export async function setBorrowingArchivedAction(input: unknown): Promise<WriteResult> {
  const r = borrowingRef.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that borrowing." }
  return refreshed(await setBorrowingArchived(await client(), r.data))
}

const borrowingId = z.object({ borrowingId: z.uuid() })

export async function deleteBorrowingAction(input: unknown): Promise<WriteResult> {
  const r = borrowingId.safeParse(input)
  if (!r.success) return { status: "error", message: "We couldn't find that borrowing." }
  return refreshed(await deleteBorrowing(await client(), r.data))
}
