import { describe, it } from "vitest";
import { queryProblem } from "../apps/web/lib/ai/knowledge/session.ts";
import { anthropicProvider } from "../apps/web/lib/ai/llm/anthropic.ts";
import { KNOWLEDGE_RULES, ROMA_SYSTEM_PROMPT, romaContext } from "../apps/web/lib/ai/prompts/roma-system.ts";
import { MAX_OUTPUT_TOKENS } from "../apps/web/lib/ai/chat.ts";
import { knowledgeSearchTool } from "../apps/web/lib/ai/tools/knowledge.ts";
import { type FinanceTool, toToolDef } from "../apps/web/lib/ai/tools/types.ts";
import { readEnvFile } from "./knowledge-env.ts";
import { runEvaluation } from "./knowledge-eval.ts";

// The knowledge evaluation with the model's query (10.6d): `npm run knowledge:eval -- --model-query`
// runs this file; never CI, never Claude. The model gets what the app sends for a general
// question (Roma's system prompt, the knowledge route, the knowledge rules, the knowledge_search
// definition) with knowledge_search the only tool, no records tools and no personal data: the
// question alone, today's date in India and the currency INR. Its first knowledge_search query is
// kept, checked as the app checks it, and searched beside the words as typed (knowledge-eval.ts).
// The key comes from the private env file (KNOWLEDGE_ENV_FILE) and is never printed.

const run = process.env.KNOWLEDGE_EVAL_MODEL_QUERY === "1" && !process.env.CI;

describe.skipIf(!run)("knowledge evaluation with the model's query (owner only)", () => {
  it(
    "reports the loose questions as typed and with the model's query",
    async () => {
      const env = readEnvFile();
      const apiKey = env.get("ANTHROPIC_API_KEY") ?? "";
      if (apiKey.length < 20) throw new Error("Set ANTHROPIC_API_KEY in the env file for --model-query.");
      const provider = anthropicProvider({ apiKey, model: env.get("LLM_MODEL") || "claude-haiku-5-5" });
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const system = [ROMA_SYSTEM_PROMPT, romaContext({ today, currency: "INR", route: "knowledge" }), KNOWLEDGE_RULES];
      const tools = [toToolDef(knowledgeSearchTool as FinanceTool)];

      await runEvaluation({
        includeDrafts: process.env.KNOWLEDGE_EVAL_INCLUDE_DRAFTS === "1",
        queryFor: async (question) => {
          const response = await provider.complete({ system, messages: [{ role: "user", text: question }], tools, maxOutputTokens: MAX_OUTPUT_TOKENS }, AbortSignal.timeout(45_000));
          const input = knowledgeSearchTool.input.safeParse(response.toolCalls.find((c) => c.name === "knowledge_search")?.input);
          if (!input.success) return null;
          return queryProblem(input.data.query, []) ? null : input.data.query;
        },
      });
    },
    20 * 60_000,
  );
});
