import type { BorrowingReturnPlan, DueStatus } from "@fin-creador/domain"
import type { BorrowingRelationship } from "@fin-creador/schemas"
import type { UserClient } from "../income/client"
import { accountBalances } from "../loans/writers"
import type { ShortTermData, ShortTermHistory } from "./view"

// Loads the cards, statements, bills, borrowings and their payments for the Loans &
// Liabilities page, the bell and the Overview, as the signed-in user (RLS: only their rows).

export async function loadShortTermData(supabase: UserClient): Promise<{ data: ShortTermData; history: ShortTermHistory } | null> {
  const [cards, statements, dues, progress, borrowings, payments, allPayments, billPayments, categories, borrowingProgress] = await Promise.all([
    supabase
      .from("credit_cards")
      .select("id, account_id, issuer, product, product_other, nickname, currency, limit_minor, statement_day, due_day, opening_owed_minor, tracking_started_on, archived_at, created_at")
      .order("created_at"),
    supabase
      .from("card_statements")
      .select("id, card_id, statement_date, due_date, total_minor, minimum_minor, emi_included_minor, owed_at_statement_minor, difference_minor")
      .order("statement_date", { ascending: false }),
    supabase
      .from("due_items")
      .select("id, kind, card_statement_id, borrowing_id, seq, due_date, amount_due_minor, minimum_due_minor, interest_minor, pay_from_account_id, status, planned_on, planned_account_id")
      .in("kind", ["card_bill", "borrowing_due"]),
    supabase.from("card_bill_progress").select("due_item_id, paid_minor"),
    supabase
      .from("borrowings")
      .select(
        "id, account_id, lender, relationship, reason, currency, borrowed_minor, amount_to_return_minor, return_on, return_plan, instalment_count, repay_from_account_id, received_on, receipt_transaction_id, archived_at, created_at",
      )
      .order("created_at"),
    supabase.from("liability_payments").select("id, liability_account_id, account_id, paid_on, principal_minor, interest_minor").is("voided_at", null),
    // History the database counts for deletes (voided payments included).
    supabase.from("liability_payments").select("liability_account_id"),
    supabase.from("due_payments").select("due_item_id"),
    supabase.from("categories").select("id, name").eq("kind", "expense").is("archived_at", null).order("name"),
    supabase.from("borrowing_due_progress").select("due_item_id, remaining_minor, remaining_interest_minor, remaining_principal_minor"),
  ])
  if (
    cards.error ||
    statements.error ||
    dues.error ||
    progress.error ||
    borrowings.error ||
    payments.error ||
    allPayments.error ||
    billPayments.error ||
    categories.error ||
    borrowingProgress.error
  )
    return null

  const cardAccounts = cards.data.map((c) => c.account_id)
  const borrowingAccounts = borrowings.data.map((b) => b.account_id)
  const receiptIds = borrowings.data.flatMap((b) => (b.receipt_transaction_id ? [b.receipt_transaction_id] : []))
  const [balances, receipts, entries] = await Promise.all([
    accountBalances(supabase, [...cardAccounts, ...borrowingAccounts]),
    receiptIds.length ? supabase.from("transactions").select("id, counter_account_id").in("id", receiptIds) : Promise.resolve({ data: [], error: null }),
    // One row per card is enough to know it has purchases (voided ones count).
    Promise.all(cardAccounts.map((id) => supabase.from("transactions").select("account_id").eq("account_id", id).limit(1))),
  ])
  if (!balances || receipts.error || entries.some((e) => e.error)) return null
  const withEntries = new Set(entries.flatMap((e) => (e.data ?? []).map((r) => r.account_id)))
  const receiptAccount = new Map((receipts.data ?? []).map((r) => [r.id, r.counter_account_id]))

  // Names of accounts that payments and receipts used (archived ones too).
  const touched = [
    ...new Set([
      ...payments.data.map((p) => p.account_id),
      ...[...receiptAccount.values()].filter((v): v is string => !!v),
      ...dues.data.flatMap((d) => (d.pay_from_account_id ? [d.pay_from_account_id] : [])),
    ]),
  ]
  const names = touched.length ? await supabase.from("accounts").select("id, name").in("id", touched) : { data: [], error: null }
  if (names.error) return null

  const paid = new Map(progress.data.map((p) => [p.due_item_id, p.paid_minor ?? 0]))
  const left = new Map(borrowingProgress.data.map((p) => [p.due_item_id, p]))
  return {
    history: {
      everPaidBillIds: billPayments.data.map((p) => p.due_item_id),
      everPaidLiabilityAccounts: allPayments.data.map((p) => p.liability_account_id),
    },
    data: {
      cards: cards.data.map((c) => ({
        id: c.id,
        accountId: c.account_id,
        issuer: c.issuer,
        product: c.product,
        productOther: c.product_other,
        nickname: c.nickname,
        currency: c.currency,
        limitMinor: c.limit_minor,
        statementDay: c.statement_day,
        dueDay: c.due_day,
        openingOwedMinor: c.opening_owed_minor,
        trackingStartedOn: c.tracking_started_on,
        archivedAt: c.archived_at,
        createdAt: c.created_at,
        balanceMinor: balances.get(c.account_id) ?? 0,
        hasEntries: withEntries.has(c.account_id),
      })),
      statements: statements.data.map((s) => ({
        id: s.id,
        cardId: s.card_id,
        statementDate: s.statement_date,
        dueDate: s.due_date,
        totalMinor: s.total_minor,
        minimumMinor: s.minimum_minor,
        emiIncludedMinor: s.emi_included_minor,
        owedAtStatementMinor: s.owed_at_statement_minor,
        differenceMinor: s.difference_minor,
      })),
      bills: dues.data.flatMap((d) =>
        d.kind === "card_bill" && d.card_statement_id
          ? [
              {
                id: d.id,
                statementId: d.card_statement_id,
                dueDate: d.due_date,
                amountDueMinor: d.amount_due_minor,
                minimumDueMinor: d.minimum_due_minor,
                status: d.status as DueStatus,
                plannedOn: d.planned_on,
                plannedAccountId: d.planned_account_id,
                paidMinor: paid.get(d.id) ?? 0,
              },
            ]
          : [],
      ),
      borrowings: borrowings.data.map((b) => ({
        id: b.id,
        accountId: b.account_id,
        lender: b.lender,
        relationship: b.relationship as BorrowingRelationship | null,
        reason: b.reason,
        currency: b.currency,
        borrowedMinor: b.borrowed_minor,
        amountToReturnMinor: b.amount_to_return_minor,
        returnOn: b.return_on,
        returnPlan: b.return_plan as BorrowingReturnPlan | null,
        instalmentCount: b.instalment_count,
        repayFromAccountId: b.repay_from_account_id,
        receivedOn: b.received_on,
        receiptAccountId: b.receipt_transaction_id ? (receiptAccount.get(b.receipt_transaction_id) ?? null) : null,
        archivedAt: b.archived_at,
        createdAt: b.created_at,
        balanceMinor: balances.get(b.account_id) ?? 0,
      })),
      borrowingDues: dues.data.flatMap((d) =>
        d.kind === "borrowing_due" && d.borrowing_id
          ? [
              {
                id: d.id,
                borrowingId: d.borrowing_id,
                seq: d.seq,
                dueDate: d.due_date,
                amountDueMinor: d.amount_due_minor,
                interestMinor: d.interest_minor ?? 0,
                payFromAccountId: d.pay_from_account_id,
                remainingMinor: left.get(d.id)?.remaining_minor ?? 0,
                remainingInterestMinor: left.get(d.id)?.remaining_interest_minor ?? 0,
                remainingPrincipalMinor: left.get(d.id)?.remaining_principal_minor ?? 0,
                status: d.status as DueStatus,
                plannedOn: d.planned_on,
                plannedAccountId: d.planned_account_id,
              },
            ]
          : [],
      ),
      liabilityPayments: payments.data.map((p) => ({
        id: p.id,
        liabilityAccountId: p.liability_account_id,
        accountId: p.account_id,
        paidOn: p.paid_on,
        principalMinor: p.principal_minor,
        interestMinor: p.interest_minor,
      })),
      accountNames: Object.fromEntries((names.data ?? []).map((a) => [a.id, a.name])),
      expenseCategories: categories.data,
    },
  }
}
