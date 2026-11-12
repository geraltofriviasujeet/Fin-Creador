// Edge Function entry (Deno). Deployed by the owner (`supabase functions deploy embed`);
// see embed.ts for the rules. verify_jwt is off in config.toml because the service role's key
// need not be a JWT; every request is checked here instead.
//
// Environment (Supabase sets all three for every function; nothing is set by hand):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { handleRequest, sameKey } from "./embed.ts";

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, options: { mean_pool: boolean; normalize: boolean }): Promise<unknown> } };
};

const auth = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth;
const session = new Supabase.ai.Session("gte-small");

Deno.serve((request) =>
  handleRequest(request, {
    async caller(token) {
      if (await sameKey(token, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))) return "service";
      // A signed-in person's access token: verified (signature and expiry) by Supabase Auth.
      const { data, error } = await auth.getClaims(token);
      if (error || !data) return null;
      return data.claims.role === "authenticated" && typeof data.claims.sub === "string" ? "person" : null;
    },
    async embed(text) {
      return (await session.run(text, { mean_pool: true, normalize: true })) as number[];
    },
    // eslint-disable-next-line no-console -- function logs (failure kind only, no text or tokens)
    log: (line) => console.log(line),
  }),
);
