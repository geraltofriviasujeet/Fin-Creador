import { authErrorMessage } from "@fin-creador/api";
import { forgotPasswordSchema, signInSchema, signUpSchema } from "@fin-creador/schemas";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { getPublicEnv } from "./env";
import { type FormState, validate } from "./form-state";
import { getSupabase } from "./supabase";

// Mirrors apps/web/app/(auth)/actions.ts: same schemas, same messages, and messages
// never reveal whether an email is registered.

function errorState(error: { code?: string; status?: number }): FormState {
  const m = authErrorMessage(error);
  return { status: "error", message: m.message, fieldErrors: m.field ? { [m.field]: m.message } : undefined, code: m.code };
}

const isRateLimited = (error: { code?: string; status?: number }) =>
  error.status === 429 || !!error.code?.startsWith("over_");

/** Email links open the web callback, which finishes the step in the browser. */
const emailRedirect = (next = "/") => `${getPublicEnv().webUrl}/auth/callback?next=${encodeURIComponent(next)}`;

export async function signIn(input: { email: string; password: string }): Promise<FormState> {
  const result = validate(signInSchema, input);
  if (!result.ok) return result.state;
  const { error } = await getSupabase().auth.signInWithPassword(result.data);
  return error ? errorState(error) : { status: "success" };
}

export async function signUp(input: { displayName: string; email: string; password: string }): Promise<FormState> {
  const result = validate(signUpSchema, input);
  if (!result.ok) return result.state;
  const { displayName, email, password } = result.data;
  const { data, error } = await getSupabase().auth.signUp({
    email,
    password,
    // display_name is read by the profiles sign-up trigger.
    options: { data: { display_name: displayName }, emailRedirectTo: emailRedirect() },
  });
  if (error) return errorState(error);
  // Email confirmation off: the session arrives and the router moves to the app.
  if (data.session) return { status: "success" };
  // Confirmation on (or the email already exists — Supabase answers identically).
  return { status: "info", message: "Check your email for a link to confirm your account, then sign in here." };
}

export async function resendConfirmation(email: string): Promise<FormState> {
  const result = validate(forgotPasswordSchema, { email });
  if (!result.ok) return result.state;
  const { error } = await getSupabase().auth.resend({
    type: "signup",
    email: result.data.email,
    options: { emailRedirectTo: emailRedirect() },
  });
  if (error && isRateLimited(error)) return errorState(error);
  return { status: "success", message: "If that email still needs confirming, we’ve sent a new link." };
}

/** Sends the reset email; its link opens the web page where the new password is set. */
export async function requestPasswordReset(email: string): Promise<FormState> {
  const result = validate(forgotPasswordSchema, { email });
  if (!result.ok) return result.state;
  const { error } = await getSupabase().auth.resetPasswordForEmail(result.data.email, {
    redirectTo: emailRedirect("/update-password"),
  });
  // Only rate limits are surfaced; anything else gets the same answer as success.
  if (error && isRateLimited(error)) return errorState(error);
  return { status: "success", message: "If an account exists for that email, we’ve sent a link to reset your password." };
}

/**
 * Return address for OAuth: exp://<dev server>/--/auth/callback in Expo Go,
 * fincreador://auth/callback in app builds. Built by hand for Expo Go because a sideloaded
 * Expo Go (e.g. from GitHub releases) is not detected as Expo Go by expo-linking, which
 * then returns our custom scheme, a scheme Expo Go cannot open.
 */
export function oauthRedirectUrl(): string {
  const devServer = Constants.expoGoConfig ? Constants.expoConfig?.hostUri : undefined;
  if (devServer) return `exp://${devServer.replace(/\/+$/, "")}/--/auth/callback`;
  return Linking.createURL("auth/callback");
}

/**
 * Supabase never redirects to an address whose host is a bare IP (it falls back to the
 * Site URL), so Expo Go served from the Mac's LAN IP cannot receive the OAuth return.
 * `npm run dev:mobile:google` serves it under an sslip.io hostname instead.
 */
export function hasIpHost(url: string): boolean {
  const host = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0] ?? "";
  return /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host) || host.startsWith("[");
}

/**
 * Google sign-in in the system auth browser with PKCE. Supabase redirects back with a
 * one-time code, which is exchanged here using the verifier kept in encrypted storage.
 */
export async function signInWithGoogle(): Promise<FormState> {
  const supabase = getSupabase();
  const redirectTo = oauthRedirectUrl();
  if (hasIpHost(redirectTo)) {
    return {
      status: "error",
      message: "Google sign-in can’t return to Expo Go over a local IP address. Restart Expo with npm run dev:mobile:google and try again.",
    };
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data.url) return { status: "error", message: "Couldn’t start Google sign-in. Please try again." };

  // Dev only: the return address must be in Supabase's Redirect URLs, or Supabase falls back to the Site URL.
  if (__DEV__) console.warn(`[auth] Google sign-in started, return address: ${redirectTo}`);
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (__DEV__) console.warn(`[auth] Google browser closed: ${result.type}`);
  if (result.type !== "success") return { status: "idle" }; // cancelled or dismissed

  const { queryParams } = Linking.parse(result.url);
  const code = typeof queryParams?.code === "string" ? queryParams.code : undefined;
  if (!code) return { status: "error", message: "Google sign-in didn’t finish. Please try again." };

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return { status: "error", message: "Google sign-in didn’t finish. Please try again." };
  return { status: "success" };
}

export async function signOut(): Promise<void> {
  // Local scope: ends this device's session even when offline.
  await getSupabase().auth.signOut({ scope: "local" });
}
