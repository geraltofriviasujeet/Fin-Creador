import { type HomeData, type HomeLoad, loadHomeData } from "@fin-creador/api";
import { useCallback, useRef, useState } from "react";
import { getPublicEnv } from "./env";
import { getSupabase } from "./supabase";

// Home's data, held in memory only (nothing is written to disk). Loaded through the shared
// loader (packages/api loadHomeData; RLS applies). A refresh that fails keeps what was shown
// and says whether the phone is offline or the server failed; a first load that fails shows
// an offline or error state with Retry.

export type HomeState =
  | { status: "loading" }
  | { status: "ready"; data: HomeData; loadedAt: Date; refreshing: boolean; problem: "offline" | "error" | null }
  | { status: "error"; message: string }
  | { status: "offline" };

export const HOME_ERROR = "We couldn't load Home. Please try again.";
export const SESSION_ENDED = "Your session has ended. Please sign in again.";

/**
 * True when the backend can't be reached at all. A no-cors GET resolves for any HTTP answer
 * (even an error status) and throws only when the request never got through.
 */
export async function backendUnreachable(timeoutMs = 8_000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${getPublicEnv().supabaseUrl}/auth/v1/health`, { method: "GET", mode: "no-cors", cache: "no-store", signal: controller.signal });
    return false;
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

export function useHomeData() {
  const [state, setState] = useState<HomeState>({ status: "loading" });
  // Only the latest request may update the screen.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++latest.current;
    setState((s) => (s.status === "ready" ? { ...s, refreshing: true } : { status: "loading" }));
    let result: HomeLoad | null;
    try {
      result = await loadHomeData(getSupabase());
    } catch {
      result = null; // fetch throws when the request never left the phone
    }
    if (id !== latest.current) return;
    if (result?.ok) {
      setState({ status: "ready", data: result.data, loadedAt: new Date(), refreshing: false, problem: null });
      return;
    }
    // Offline first: without a connection the session check also fails ("unauthenticated").
    const offline = await backendUnreachable();
    if (id !== latest.current) return;
    setState((s) => {
      if (s.status === "ready") return { ...s, refreshing: false, problem: offline ? "offline" : "error" };
      if (offline) return { status: "offline" };
      return { status: "error", message: result && !result.ok && result.reason === "unauthenticated" ? SESSION_ENDED : HOME_ERROR };
    });
  }, []);

  return { state, refresh };
}
