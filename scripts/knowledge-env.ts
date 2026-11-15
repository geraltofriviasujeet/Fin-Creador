// The private env file the knowledge scripts read (Sprint 10.6): outside the repository, never
// printed. KNOWLEDGE_ENV_FILE names it; "KEY=value" lines, quotes allowed.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function readEnvFile(): Map<string, string> {
  const path = process.env.KNOWLEDGE_ENV_FILE?.replace(/^~(?=\/)/, homedir());
  if (!path) throw new Error("Set KNOWLEDGE_ENV_FILE to the env file outside the repository.");
  const full = resolve(path);
  if (!relative(REPO, full).startsWith("..")) throw new Error("The env file must be outside the repository.");
  const values = new Map<string, string>();
  for (const line of readFileSync(full, "utf8").split(/\r?\n/)) {
    const pair = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (pair) values.set(pair[1]!, pair[2]!.replace(/^["']|["']$/g, ""));
  }
  return values;
}

/** The project's https URL and service key from the env file. */
export function projectEnv(values: Map<string, string>): { url: string; key: string } {
  const url = values.get("SUPABASE_URL") ?? "";
  const key = values.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!/^https:\/\/[^/\s]+$/.test(url.replace(/\/$/, ""))) throw new Error("SUPABASE_URL in the env file must be the project's https URL.");
  if (key.length < 20) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing from the env file.");
  return { url: url.replace(/\/$/, ""), key };
}
