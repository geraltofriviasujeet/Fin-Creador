import type { LineSaveResult } from "@fin-creador/api"

// Saving the ticked lines of a statement import in chunks, and the outcome shown after (shared by
// card and bank import; plain TypeScript so it is unit tested without the browser).

export type SaveOutcome = { tone: "success" | "error" | "info"; text: string }

export const lineText = (n: number) => (n === 1 ? "1 line" : `${n} lines`)

/**
 * Saves `keys`' lines in chunks of `size`, one call after another (each line saved on its own on
 * the server); `onChunk` gets each chunk's results as they come. Stops at the first call that fails.
 */
export async function saveInChunks<L extends { key: string }>(
  lines: readonly L[],
  size: number,
  send: (chunk: L[]) => Promise<{ ok: true; results: LineSaveResult[] } | { ok: false; message: string } | null>,
  onChunk: (results: LineSaveResult[]) => void,
): Promise<{ done: LineSaveResult[]; stopped: string | null }> {
  const done: LineSaveResult[] = []
  for (let i = 0; i < lines.length; i += size) {
    const result = await send(lines.slice(i, i + size)).catch(() => null)
    if (!result?.ok) return { done, stopped: result?.message ?? "We couldn't reach the server. Check your connection." }
    done.push(...result.results)
    onChunk(result.results)
  }
  return { done, stopped: null }
}

/** The outcome of a save: saved, already imported, or what's left to finish with Save again. */
export function savedOutcome(ticked: number, done: readonly LineSaveResult[], stopped: string | null): SaveOutcome {
  const saved = done.filter((r) => r.status === "saved").length
  const settled = done.filter((r) => r.status !== "failed").length
  if (settled < ticked) {
    return {
      tone: "error",
      text: `Saved ${lineText(saved)} of ${ticked}. ${lineText(ticked - settled)} not saved: check them and press Save again to finish.${stopped ? ` ${stopped}` : ""}`,
    }
  }
  return {
    tone: "success",
    text: ticked === 0 ? "" : saved === ticked ? `${lineText(saved)} saved.` : `${lineText(saved)} saved; ${lineText(ticked - saved)} were already imported.`,
  }
}
