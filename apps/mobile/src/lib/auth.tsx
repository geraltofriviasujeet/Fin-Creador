import type { Session } from "@supabase/supabase-js";
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { getSupabase } from "./supabase";

type AuthState = { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; session: Session };

const AuthContext = createContext<AuthState>({ status: "loading" });

export const useAuth = () => useContext(AuthContext);

/** Tracks the stored session; the router guards screens on `status`. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const supabase = getSupabase();
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setState(data.session ? { status: "signedIn", session: data.session } : { status: "signedOut" });
      })
      .catch(() => {
        if (active) setState({ status: "signedOut" });
      });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState(session ? { status: "signedIn", session } : { status: "signedOut" });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
