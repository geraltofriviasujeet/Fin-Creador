"use client"

import { useActionState, useState } from "react"
import { type AccountKind, minorToInputString } from "@fin-creador/domain"
import { BANK_TYPES, currencyOptions, INDIAN_BANKS, OTHER_BANK } from "@fin-creador/schemas"
import { saveAccountAction } from "@/app/(app)/income/actions"
import { AmountField } from "@/components/income/amount-field"
import { FormActions } from "@/components/income/form-actions"
import { useFormSuccess } from "@/components/income/use-form-success"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { initialFormState } from "@/lib/form-state"
import type { IncomeAccount } from "@/lib/income/types"

type Props = {
  kind: AccountKind
  /** Present when editing. */
  account?: IncomeAccount
  currency: string
  today: string
  /** Pre-fill "Cash in hand" for the first cash account. */
  suggestedName?: string
  onDone: () => void
}

const KNOWN_BANKS = new Set<string>(INDIAN_BANKS)

/** Add or edit a bank, cash or other account (design-spec §9). */
export function AccountForm({ kind, account, currency, today, suggestedName, onDone }: Props) {
  const [state, action, pending] = useActionState(saveAccountAction, initialFormState)
  useFormSuccess(state, onDone)
  const errors = state.fieldErrors ?? {}

  const initialBank = account ? (KNOWN_BANKS.has(account.name) ? account.name : OTHER_BANK) : ""
  const v = state.values ?? {
    bankName: initialBank,
    otherBankName: initialBank === OTHER_BANK ? account?.name ?? "" : "",
    bankType: account?.bankType ?? "savings",
    name: account?.name ?? suggestedName ?? "",
    institution: account?.institution ?? "",
    last4: account?.last4 ?? "",
    currency: account?.currency ?? currency,
    openingBalance: account ? minorToInputString(account.openingBalanceMinor, account.currency) : "",
    openingBalanceDate: account?.openingBalanceDate ?? today,
  }

  const [bankName, setBankName] = useState(v.bankName ?? "")
  const [selectedCurrency, setSelectedCurrency] = useState(v.currency ?? currency)

  return (
    <form action={action} noValidate className="grid gap-5">
      {state.status === "error" && state.message && <FormMessage tone="error">{state.message}</FormMessage>}
      {account && <input type="hidden" name="id" value={account.id} />}
      <input type="hidden" name="kind" value={kind} />

      {kind === "bank" ? (
        <>
          <SelectField name="bankName" label="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} error={errors.bankName}>
            <option value="" disabled>
              Select your bank
            </option>
            {INDIAN_BANKS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
            <option value={OTHER_BANK}>Other bank</option>
          </SelectField>
          {bankName === OTHER_BANK && (
            <TextField name="otherBankName" label="Bank's name" defaultValue={v.otherBankName} maxLength={80} error={errors.otherBankName} />
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField name="bankType" label="Account type" defaultValue={v.bankType} error={errors.bankType}>
              {BANK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </SelectField>
            <TextField name="last4" label="Last 4 digits" hint="Optional" placeholder="0000" inputMode="numeric" maxLength={4} defaultValue={v.last4} error={errors.last4} />
          </div>
        </>
      ) : (
        <>
          <TextField
            name="name"
            label="Name"
            placeholder={kind === "cash" ? "Cash in hand" : "e.g. Paytm wallet"}
            maxLength={80}
            defaultValue={v.name}
            error={errors.name}
          />
          {kind === "other" && (
            <TextField name="institution" label="Provider" hint="Optional" maxLength={80} defaultValue={v.institution} error={errors.institution} />
          )}
        </>
      )}

      <AmountField
        name="openingBalance"
        label="Opening balance"
        currency={selectedCurrency}
        defaultValue={v.openingBalance}
        error={errors.openingBalance}
        hint={kind === "bank" ? "Use a minus sign if the account is overdrawn." : undefined}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          name="openingBalanceDate"
          type="date"
          label="As of"
          max={today}
          defaultValue={v.openingBalanceDate}
          hint="Income on or after this date changes the balance."
          error={errors.openingBalanceDate}
        />
        <SelectField
          name="currency"
          label="Currency"
          value={selectedCurrency}
          onChange={(e) => setSelectedCurrency(e.target.value)}
          error={errors.currency}
        >
          {currencyOptions(selectedCurrency).map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </SelectField>
      </div>

      <FormActions submit={account ? "Save changes" : "Add account"} busy="Saving…" pending={pending} />
    </form>
  )
}
