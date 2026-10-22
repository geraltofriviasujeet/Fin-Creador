import { Redirect } from "expo-router";

// OAuth returns here (fincreador://auth/callback). The code is exchanged by
// signInWithGoogle() from the auth-session result, so this route only sends the user on;
// the root guards pick the app or sign-in depending on the session.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
