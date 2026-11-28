import { useCallback, useRef, useState } from "react";
import { SESSION_ENDED, backendUnreachable } from "./home-data";

// One screen part's data, held in memory only, with the same states as Home (lib/home-data.ts):
// a refresh that fails keeps what was shown and says whether the phone is offline or the server
// failed; a first load that fails shows an offline or error state with Retry. Used by the Plan
// tab's sections and the Budgets screen (Sprint 13c), each loading on its own.

export type LoadResult<T> = { ok: true; data: T } | { ok: false; reason: "unauthenticated" | "unavailable" };

export type LoadedState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T; loadedAt: Date; refreshing: boolean; problem: "offline" | "error" | null }
  | { status: "error"; message: string }
  | { status: "offline" };

/** `load` must be stable (useCallback) for `refresh` to be. A new `load` starts from loading. */
export function useLoaded<T>(load: () => Promise<LoadResult<T>>, errorMessage: string) {
  const [state, setState] = useState<LoadedState<T>>({ status: "loading" });
  // Only the latest request may update the screen.
  const latest = useRef(0);
  const lastLoad = useRef(load);

  const refresh = useCallback(async () => {
    const id = ++latest.current;
    const fresh = lastLoad.current !== load;
    lastLoad.current = load;
    setState((s) => (s.status === "ready" && !fresh ? { ...s, refreshing: true } : { status: "loading" }));
    let result: LoadResult<T> | null;
    try {
      result = await load();
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
      return { status: "error", message: result && !result.ok && result.reason === "unauthenticated" ? SESSION_ENDED : errorMessage };
    });
  }, [load, errorMessage]);

  return { state, refresh };
}
