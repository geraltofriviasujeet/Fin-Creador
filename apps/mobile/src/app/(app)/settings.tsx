import type { ProfileFormValues } from "@fin-creador/api";
import { countryOptions, currencyOptions, timeZoneOptions } from "@fin-creador/schemas";
import { LogOut, RotateCw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Button } from "@/components/button";
import { Card, CardDescription, CardTitle } from "@/components/card";
import { FormMessage } from "@/components/form-message";
import { Screen } from "@/components/screen";
import { SelectField } from "@/components/select-field";
import { TextField } from "@/components/text-field";
import { useToast } from "@/components/toast";
import { signOut } from "@/lib/auth-actions";
import { type FormState, idle } from "@/lib/form-state";
import { type ProfileLoad, loadProfile, saveProfile } from "@/lib/profile";
import { colors, spacing } from "@/theme";

const COUNTRIES = countryOptions();

export default function SettingsScreen() {
  const [load, setLoad] = useState<ProfileLoad | "loading">("loading");

  const fetchProfile = useCallback(
    () =>
      loadProfile()
        .catch((): ProfileLoad => ({ ok: false }))
        .then(setLoad),
    []
  );

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const retry = () => {
    setLoad("loading");
    void fetchProfile();
  };

  return (
    <Screen>
      <Card style={styles.card}>
        <View>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Country, currency and time zone decide how amounts are shown and where your days and months start.
          </CardDescription>
        </View>
        {load === "loading" ? (
          <View style={styles.loading} accessibilityLabel="Loading your profile">
            <ActivityIndicator color={colors.ink} />
          </View>
        ) : load.ok ? (
          <ProfileForm initial={load.values} />
        ) : (
          <View style={styles.card}>
            <FormMessage tone="error" message="We couldn’t load your profile. Check your connection and try again." />
            <Button label="Try again" variant="secondary" icon={RotateCw} onPress={retry} />
          </View>
        )}
      </Card>

      <AccountCard email={load !== "loading" && load.ok ? load.email : undefined} />
    </Screen>
  );
}

function ProfileForm({ initial }: { initial: ProfileFormValues }) {
  const toast = useToast();
  const [values, setValues] = useState(initial);
  const [state, setState] = useState<FormState>(idle);
  const [saving, setSaving] = useState(false);
  const currencies = useMemo(() => currencyOptions(initial.currency), [initial.currency]);
  const timeZones = useMemo(() => timeZoneOptions(initial.timeZone), [initial.timeZone]);
  const set = (key: keyof ProfileFormValues) => (value: string) => setValues((v) => ({ ...v, [key]: value }));
  const errors = state.fieldErrors ?? {};

  async function submit() {
    setSaving(true);
    try {
      const next = await saveProfile(values);
      setState(next);
      if (next.status === "success") toast.show(next.message ?? "Profile saved.");
    } catch {
      setState({ status: "error", message: "We couldn’t save your profile. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      {state.status === "error" && state.message ? <FormMessage tone="error" message={state.message} /> : null}
      <TextField
        label="Name"
        value={values.displayName}
        onChangeText={set("displayName")}
        error={errors.displayName}
        autoComplete="name"
        textContentType="name"
      />
      <TextField
        label="Phone (optional)"
        value={values.phone}
        onChangeText={set("phone")}
        error={errors.phone}
        placeholder="+91 98765 43210"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
      />
      <SelectField
        label="Country"
        value={values.country}
        options={COUNTRIES}
        onChange={set("country")}
        error={errors.country}
        searchPlaceholder="Search countries"
      />
      <SelectField
        label="Currency"
        value={values.currency}
        options={currencies}
        onChange={set("currency")}
        error={errors.currency}
        searchPlaceholder="Search by code or name"
      />
      <SelectField
        label="Time zone"
        hint="Used for day, week and month boundaries and reminders."
        value={values.timeZone}
        options={timeZones}
        onChange={set("timeZone")}
        error={errors.timeZone}
        searchPlaceholder="Search, e.g. Kolkata"
      />
      <Button label="Save profile" fullWidth loading={saving} onPress={submit} />
    </View>
  );
}

function AccountCard({ email }: { email?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card style={styles.card}>
      <View>
        <CardTitle>Account</CardTitle>
        <CardDescription>{email ? `Signed in as ${email}` : "Signed in"}</CardDescription>
      </View>
      <Button
        label="Sign out"
        variant="secondary"
        icon={LogOut}
        loading={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await signOut(); // the router returns to sign-in when the session ends
          } finally {
            setBusy(false);
          }
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing[4] },
  loading: { paddingVertical: spacing[8], alignItems: "center" },
});
