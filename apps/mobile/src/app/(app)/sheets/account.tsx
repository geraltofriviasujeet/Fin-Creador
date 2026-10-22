import { type IncomePageData, saveAccount } from "@fin-creador/api";
import { type AccountKind, minorToInputString } from "@fin-creador/domain";
import { BANK_TYPES, currencyOptions, INDIAN_BANKS, OTHER_BANK } from "@fin-creador/schemas";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { DateField } from "@/components/income/date-field";
import { IncomeGate } from "@/components/income/income-gate";
import { Sheet } from "@/components/income/sheet";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { param } from "@/lib/income-format";
import { getSupabase } from "@/lib/supabase";
import { useSave } from "@/lib/use-save";
import { spacing } from "@/theme";

const TITLES: Record<AccountKind, string> = { bank: "Add bank account", cash: "Add cash", other: "Add other account" };
const KNOWN_BANKS = new Set<string>(INDIAN_BANKS);
const BANK_OPTIONS = [{ value: "", label: "Select your bank" }, ...INDIAN_BANKS.map((b) => ({ value: b, label: b })), { value: OTHER_BANK, label: "Other bank" }];

/** Add or edit a bank, cash or other account (params: kind, id when editing). */
export default function AccountSheet() {
  const params = useLocalSearchParams<{ kind?: string; id?: string }>();
  const id = param(params.id);
  const kindParam = param(params.kind);
  const kind: AccountKind = kindParam === "cash" || kindParam === "other" ? kindParam : "bank";
  // Cash is just an amount: no eyebrow, title "Add cash" / "Edit cash".
  const title = kind === "cash" ? (id ? "Edit cash" : "Add cash") : id ? "Edit account" : TITLES[kind];
  const eyebrow = kind === "cash" ? undefined : id ? "Edit account" : "New account";
  return (
    <IncomeGateSheet title={title} eyebrow={eyebrow}>
      {(data) => <AccountForm data={data} kind={kind} id={id} />}
    </IncomeGateSheet>
  );
}

function IncomeGateSheet({ title, eyebrow, children }: { title: string; eyebrow?: string; children: (d: IncomePageData) => React.ReactNode }) {
  return (
    <Sheet eyebrow={eyebrow} title={title}>
      <IncomeGate>{children}</IncomeGate>
    </Sheet>
  );
}

function AccountForm({ data, kind, id }: { data: IncomePageData; kind: AccountKind; id: string }) {
  const router = useRouter();
  const account = id ? data.accounts.find((a) => a.id === id) : undefined;
  // One active cash account per person, always named "Cash in hand".
  const activeCash = data.accounts.find((a) => a.kind === "cash" && !a.archived);
  const initialBank = account ? (KNOWN_BANKS.has(account.name) ? account.name : OTHER_BANK) : "";

  const [bankName, setBankName] = useState(initialBank);
  const [otherBankName, setOtherBankName] = useState(initialBank === OTHER_BANK ? (account?.name ?? "") : "");
  const [bankType, setBankType] = useState<string>(account?.bankType ?? "savings");
  const [last4, setLast4] = useState(account?.last4 ?? "");
  const [name, setName] = useState(account?.name ?? (kind === "cash" ? "Cash in hand" : ""));
  const [institution, setInstitution] = useState(account?.institution ?? "");
  const [openingBalance, setOpeningBalance] = useState(account ? minorToInputString(account.openingBalanceMinor, account.currency) : "");
  const [openingBalanceDate, setOpeningBalanceDate] = useState(account?.openingBalanceDate ?? data.today);
  const [currency, setCurrency] = useState(account?.currency ?? data.currency);
  const { save, busy, fieldErrors, formError } = useSave();

  if (id && !account) return <FormMessage tone="error" message="We couldn't find that account." />;
  if (kind === "cash" && !account && activeCash) {
    return (
      <View style={styles.gap}>
        <FormMessage tone="info" message="You already have Cash in hand. Update its amount instead." />
        <Button label="Update cash in hand" onPress={() => router.replace("/sheets/cash")} />
      </View>
    );
  }

  return (
    <View style={styles.gap}>
      {formError ? <FormMessage tone="error" message={formError} /> : null}
      {kind === "bank" ? (
        <>
          <SelectField label="Bank name" value={bankName} options={BANK_OPTIONS} onChange={setBankName} error={fieldErrors.bankName} searchPlaceholder="Search banks" />
          {bankName === OTHER_BANK ? (
            <TextField label="Bank's name" value={otherBankName} onChangeText={setOtherBankName} maxLength={80} error={fieldErrors.otherBankName} />
          ) : null}
          <SelectField
            label="Account type"
            value={bankType}
            options={BANK_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            onChange={setBankType}
            error={fieldErrors.bankType}
            searchPlaceholder="Search"
          />
          <TextField label="Last 4 digits" hint="Optional" value={last4} onChangeText={setLast4} keyboardType="number-pad" maxLength={4} placeholder="0000" error={fieldErrors.last4} />
        </>
      ) : (
        <>
          {kind === "other" ? (
            <>
              <TextField label="Name" value={name} onChangeText={setName} maxLength={80} placeholder="e.g. Paytm wallet" error={fieldErrors.name} />
              <TextField label="Provider" hint="Optional" value={institution} onChangeText={setInstitution} maxLength={80} error={fieldErrors.institution} />
            </>
          ) : null}
        </>
      )}
      {kind === "cash" ? (
        // Cash is just the amount on hand now: as of today, in the profile currency.
        <TextField
          label="Amount"
          value={openingBalance}
          onChangeText={setOpeningBalance}
          keyboardType="decimal-pad"
          placeholder="0.00"
          hint={`The cash you have now, in ${currency}.`}
          error={fieldErrors.openingBalance ?? fieldErrors.name ?? fieldErrors.openingBalanceDate}
        />
      ) : (
        <>
          <TextField
            label="Opening balance"
            value={openingBalance}
            onChangeText={setOpeningBalance}
            keyboardType="numbers-and-punctuation"
            placeholder="0.00"
            hint={kind === "bank" ? `In ${currency}. Use a minus sign if the account is overdrawn.` : `In ${currency}.`}
            error={fieldErrors.openingBalance}
          />
          <DateField
            label="As of"
            value={openingBalanceDate}
            max={data.today}
            onChange={setOpeningBalanceDate}
            hint="Income on or after this date changes the balance."
            error={fieldErrors.openingBalanceDate}
          />
          <SelectField label="Currency" value={currency} options={currencyOptions(currency)} onChange={setCurrency} error={fieldErrors.currency} searchPlaceholder="Search by code or name" />
        </>
      )}
      <Button
        label={account ? "Save changes" : kind === "cash" ? "Add cash" : "Add account"}
        fullWidth
        loading={busy}
        onPress={() =>
          void save(() =>
            saveAccount(getSupabase(), {
              id: account?.id,
              kind,
              bankType,
              bankName,
              otherBankName,
              name,
              institution,
              last4,
              currency,
              openingBalance,
              openingBalanceDate,
            })
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: spacing[4] } });
