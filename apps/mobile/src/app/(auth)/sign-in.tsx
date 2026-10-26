import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, Text, type TextInputInstance, View } from "react-native";
import { AuthShell, OrDivider } from "@/components/auth-shell";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { TextField } from "@/components/text-field";
import { TextLink } from "@/components/text-link";
import { resendConfirmation, signIn, signInWithGoogle } from "@/lib/auth-actions";
import { type FormState, idle } from "@/lib/form-state";
import { spacing, text } from "@/theme";

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<FormState>(idle);
  const [resendState, setResendState] = useState<FormState>(idle);
  const [busy, setBusy] = useState<"password" | "google" | "resend" | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  async function run(kind: "password" | "google", action: () => Promise<FormState>) {
    setBusy(kind);
    setResendState(idle);
    try {
      const next = await action();
      setState(next);
      if (next.status !== "error") setPassword("");
    } catch {
      setState({ status: "error", message: "Couldn’t reach the server. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    setBusy("resend");
    try {
      setResendState(await resendConfirmation(email));
    } catch {
      setResendState({ status: "error", message: "Couldn’t reach the server. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to see where your money is going."
      footer={
        <View style={styles.row}>
          <Text style={text.bodySmall}>New to FinCreador?</Text>
          <TextLink label="Create an account" onPress={() => router.replace("/sign-up")} />
        </View>
      }
    >
      {state.status === "error" && state.message ? <FormMessage tone="error" message={state.message} /> : null}
      {state.code === "email_not_confirmed" ? (
        <View style={styles.resend}>
          <Button label="Resend confirmation email" variant="secondary" loading={busy === "resend"} onPress={resend} />
          {resendState.message ? (
            <FormMessage tone={resendState.status === "error" ? "error" : "success"} message={resendState.message} />
          ) : null}
        </View>
      ) : null}

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={state.fieldErrors?.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={state.fieldErrors?.password}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => run("password", () => signIn({ email, password }))}
      />
      <View style={styles.forgot}>
        <TextLink label="Forgot password?" onPress={() => router.push({ pathname: "/forgot-password", params: { email } })} />
      </View>
      <Button
        label="Sign in"
        fullWidth
        loading={busy === "password"}
        disabled={busy !== null}
        onPress={() => run("password", () => signIn({ email, password }))}
      />
      <OrDivider />
      <Button
        label="Continue with Google"
        variant="secondary"
        fullWidth
        loading={busy === "google"}
        disabled={busy !== null}
        onPress={() => run("google", signInWithGoogle)}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing[1], flexWrap: "wrap", justifyContent: "center" },
  forgot: { alignItems: "flex-end", marginTop: -spacing[2] },
  resend: { gap: spacing[3] },
});
