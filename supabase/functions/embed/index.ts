// Edge Function entry (Deno). Deployed by the owner (`supabase functions deploy embed`);
// see embed.ts for the rules. verify_jwt is off in config.toml because the service role's key
// need not be a JWT; every request is checked here instead.
//
// Environment (Supabase sets these for every function; nothing is set by hand):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (legacy), SUPABASE_SECRET_KEYS
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { handleRequest, isServiceKey, serviceKeys } from "./embed.ts";

declare const Supabase: {
  ai: { Session: new (model: string) => { run(input: string, options: { mean_pool: boolean; normalize: boolean }): Promise<unknown> } };
};

const session = new Supabase.ai.Session("gte-small");

Deno.serve((request) =>
  handleRequest(request, {
    isService: (token) => isServiceKey(token, serviceKeys(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), Deno.env.get("SUPABASE_SECRET_KEYS"))),
    async allowQuestion(token, requestId) {
      // The person's own token: the database checks it, and the question must be theirs.
      const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data, error } = await db.rpc("roma_knowledge_embed", { p_request_id: requestId });
      return !error && data === true;
    },
    async embed(text) {
      return (await session.run(text, { mean_pool: true, normalize: true })) as number[];
    },
    // eslint-disable-next-line no-console -- function logs (failure kind only, no text or tokens)
    log: (line) => console.log(line),
  }),
);
