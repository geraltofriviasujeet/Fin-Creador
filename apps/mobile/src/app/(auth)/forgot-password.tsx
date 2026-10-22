import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { TextField } from "@/components/text-field";
import { TextLink } from "@/components/text-link";
import { requestPasswordReset } from "@/lib/auth-actions";
import { type FormState, idle } from "@/lib/form-state";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [state, setState] = useState<FormState>(idle);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      setState(await requestPasswordReset(email));
    } catch {
      setState({ status: "error", message: "Couldn’t reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      description="We’ll email you a link. It opens in your browser, where you choose a new password."
      footer={<TextLink label="Back to sign in" onPress={() => router.replace("/sign-in")} />}
    >
      {state.message ? <FormMessage tone={state.status === "error" ? "error" : "success"} message={state.message} /> : null}
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={state.fieldErrors?.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={submit}
      />
      <View style={styles.actions}>
        <Button label="Send reset link" fullWidth loading={busy} onPress={submit} />
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({ actions: { marginTop: 4 } });
