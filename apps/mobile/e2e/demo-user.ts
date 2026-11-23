// Creates a confirmed demo user on CI's throwaway local Supabase, through the public Auth API
// only (publishable key; no service key): sign up, read the confirmation email from the local
// Mailpit inbox, and verify its token hash. Refuses anything but a local Supabase.
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const PASSWORD = "Demo-password-13a!";

function localSupabase() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // handled below
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Mobile E2E only runs against a local Supabase (EXPO_PUBLIC_SUPABASE_URL must be 127.0.0.1 or localhost).");
  }
  if (!key) throw new Error("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.");
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" } };
}

async function confirmationTokenHash(email: string, timeoutMs = 20_000): Promise<{ tokenHash: string; type: string }> {
  const deadline = Date.now() + timeoutMs;
  const query = encodeURIComponent(`to:"${email}"`);
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    const { messages = [] } = (await res.json()) as { messages?: { ID: string }[] };
    if (messages[0]) {
      const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`)).json()) as { HTML?: string };
      const href = [...(message.HTML ?? "").matchAll(/href="([^"]*)"/g)]
        .map((m) => (m[1] ?? "").replaceAll("&amp;", "&"))
        .find((link) => link.includes("token_hash="));
      if (!href) throw new Error("Confirmation email has no token_hash link.");
      const params = new URL(href).searchParams;
      return { tokenHash: params.get("token_hash") ?? "", type: params.get("type") ?? "email" };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No confirmation email for ${email} within ${timeoutMs} ms.`);
}

export async function createConfirmedUser(label: string): Promise<{ email: string; password: string }> {
  const { url, headers } = localSupabase();
  const email = `mobile-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const signUp = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password: PASSWORD, data: { display_name: "Demo user" } }),
  });
  if (!signUp.ok) throw new Error(`Sign-up failed: ${signUp.status} ${await signUp.text()}`);

  const { tokenHash, type } = await confirmationTokenHash(email);
  const verify = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type, token_hash: tokenHash }),
  });
  if (!verify.ok) throw new Error(`Confirmation failed: ${verify.status} ${await verify.text()}`);
  return { email, password: PASSWORD };
}
