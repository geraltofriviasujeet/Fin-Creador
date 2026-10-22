import "./crypto-polyfill"; // must run before supabase-js generates PKCE values
import type { Database } from "@fin-creador/api";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";
import { getPublicEnv } from "./env";
import { sessionStorage } from "./session-storage";

// One client for the app, publishable key only; RLS protects every row.

let client: SupabaseClient<Database> | undefined;

export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;
  const env = getPublicEnv();
  const created = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      storage: sessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // no URL bar on native; OAuth codes are exchanged explicitly
      flowType: "pkce",
    },
  });
  // Refresh tokens only while the app is in the foreground.
  AppState.addEventListener("change", (state) => {
    if (state === "active") void created.auth.startAutoRefresh();
    else void created.auth.stopAutoRefresh();
  });
  client = created;
  return created;
}
