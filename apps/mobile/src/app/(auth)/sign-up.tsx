import { PASSWORD_MIN_LENGTH } from "@fin-creador/schemas";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, Text, type TextInputInstance, View } from "react-native";
import { AuthShell, OrDivider } from "@/components/auth-shell";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/form-message";
import { TextField } from "@/components/text-field";
import { TextLink } from "@/components/text-link";
import { resendConfirmation, signInWithGoogle, signUp } from "@/lib/auth-actions";
import { type FormState, idle } from "@/lib/form-state";
import { spacing, text } from "@/theme";

export default function SignUpScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<FormState>(idle);
  const [resendState, setResendState] = useState<FormState>(idle);
  const [busy, setBusy] = useState<"email" | "google" | "resend" | null>(null);
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  async function run(kind: "email" | "google" | "resend", action: () => Promise<FormState>, target = setState) {
    setBusy(kind);
    try {
      const next = await action();
      target(next);
      if (kind === "email" && next.status !== "error") setPassword("");
    } catch {
      target({ status: "error", message: "Couldn’t reach the server. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  const submit = () => run("email", () => signUp({ displayName, email, password }));

  // Email confirmation on: tell the user what happens next and offer a resend.
  if (state.status === "info") {
    return (
      <AuthShell title="Check your email" description={`We sent a confirmation link to ${email.trim()}.`}>
        <FormMessage tone="info" message={state.message ?? ""} />
        <Text style={text.bodySmall}>
          Open the link on any device. Once your email is confirmed, come back here and sign in.
        </Text>
        {resendState.message ? (
          <FormMessage tone={resendState.status === "error" ? "error" : "success"} message={resendState.message} />
        ) : null}
        <Button label="Go to sign in" fullWidth onPress={() => router.replace("/sign-in")} />
        <Button
          label="Resend confirmation email"
          variant="secondary"
          fullWidth
          loading={busy === "resend"}
          onPress={() => run("resend", () => resendConfirmation(email), setResendState)}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      description="Track spending, income and goals in one place."
      footer={
        <View style={styles.row}>
          <Text style={text.bodySmall}>Already have an account?</Text>
          <TextLink label="Sign in" onPress={() => router.replace("/sign-in")} />
        </View>
      }
    >
      {state.status === "error" && state.message ? <FormMessage tone="error" message={state.message} /> : null}
      <TextField
        label="Your name"
        value={displayName}
        onChangeText={setDisplayName}
        error={state.fieldErrors?.displayName}
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={emailRef}
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
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        value={password}
        onChangeText={setPassword}
        error={state.fieldErrors?.password}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Button label="Create account" fullWidth loading={busy === "email"} disabled={busy !== null} onPress={submit} />
      <OrDivider />
      <Button
        label="Sign up with Google"
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
});
