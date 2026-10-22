// Secret detection used by scripts/check-secrets.mjs (and unit tested in secret-scan.test.ts).
// Finds things that must never ship: Supabase secret keys, non-anon JWTs (service_role),
// Google OAuth client secrets, private keys, AWS keys, and caller-supplied canary values.
// Matches are reported masked; the secret itself is never printed.

const PATTERNS = [
  { kind: "Supabase secret key", re: /sb_secret_[A-Za-z0-9_-]{10,}/g },
  { kind: "Google OAuth client secret", re: /GOCSPX-[A-Za-z0-9_-]{10,}/g },
  { kind: "Private key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g },
  { kind: "AWS access key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
];

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

function jwtRole(token) {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const role = JSON.parse(json).role;
    return typeof role === "string" ? role : undefined;
  } catch {
    return undefined;
  }
}

export function mask(value) {
  return value.length <= 12 ? "***" : `${value.slice(0, 8)}…(${value.length} chars)`;
}

/**
 * Returns findings for one text. JWTs are allowed only with role "anon" (the legacy public
 * key); a JWT with no role (e.g. a user session) is reported too, since none belongs in code.
 */
export function findSecrets(text, { canaries = [] } = {}) {
  const findings = [];
  for (const { kind, re } of PATTERNS) {
    for (const m of text.matchAll(re)) findings.push({ kind, index: m.index, preview: mask(m[0]) });
  }
  for (const m of text.matchAll(JWT)) {
    const role = jwtRole(m[0]);
    if (role !== "anon") findings.push({ kind: `JWT (role: ${role ?? "none"})`, index: m.index, preview: mask(m[0]) });
  }
  for (const canary of canaries) {
    if (!canary) continue;
    let i = text.indexOf(canary);
    while (i !== -1) {
      findings.push({ kind: "Canary value (server-only env leaked)", index: i, preview: mask(canary) });
      i = text.indexOf(canary, i + canary.length);
    }
  }
  return findings;
}

/** Printable ASCII runs, so compiled/binary bundles (e.g. Hermes .hbc) can be scanned too. */
export function printableText(buffer) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= buffer.length; i++) {
    const b = buffer[i];
    const printable = b !== undefined && b >= 0x20 && b <= 0x7e;
    if (printable && start === -1) start = i;
    if (!printable && start !== -1) {
      if (i - start >= 8) runs.push(buffer.toString("latin1", start, i));
      start = -1;
    }
  }
  return runs.join("\n");
}

/** Real env files must never be tracked; only *.example templates are. */
export function isForbiddenEnvFile(path) {
  const name = path.split("/").pop() ?? "";
  return /^\.env(\..+)?$/.test(name) && !name.endsWith(".example");
}
