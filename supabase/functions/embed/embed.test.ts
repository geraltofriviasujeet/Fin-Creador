import { describe, expect, it } from "vitest";
import { DIMENSIONS, MAX_BATCH, MAX_PASSAGE_CHARS, MAX_QUESTION_CHARS, bearer, handleRequest, isServiceKey, tokenKind, readRequestId, readTexts, sameKey, serviceKeys, type Deps } from "./embed.ts";

const VECTOR = Array.from({ length: DIMENSIONS }, (_, i) => i / DIMENSIONS);

const REQUEST_ID = "a1000000-0000-4000-8000-000000000001";

// service: the token is the service-role key. allowed: roma_knowledge_embed's answer.
function deps(service: boolean, allowed = true, embed: (text: string) => Promise<number[]> = async () => VECTOR) {
  const logs: string[] = [];
  const seen: string[] = [];
  const asked: string[] = [];
  const d: Deps = {
    isService: async () => service,
    allowQuestion: async (_token, requestId) => {
      asked.push(requestId);
      return allowed;
    },
    embed: async (text) => {
      seen.push(text);
      return embed(text);
    },
    log: (line) => logs.push(line),
  };
  return { d, logs, seen, asked };
}

const question = (text: string) => ({ texts: [text], request_id: REQUEST_ID });

const post = (body: unknown, token: string | null = "t") =>
  new Request("https://example.test/functions/v1/embed", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("bearer", () => {
  it("reads a bearer token and nothing else", () => {
    expect(bearer("Bearer abc.def")).toBe("abc.def");
    expect(bearer("bearer abc")).toBe("abc");
    expect(bearer("Basic abc")).toBeNull();
    expect(bearer("Bearer a b")).toBeNull();
    expect(bearer(null)).toBeNull();
  });
});

describe("sameKey", () => {
  it("matches only the exact key", async () => {
    expect(await sameKey("k".repeat(40), "k".repeat(40))).toBe(true);
    expect(await sameKey("k".repeat(39), "k".repeat(40))).toBe(false);
    expect(await sameKey("", undefined)).toBe(false);
    expect(await sameKey("", "")).toBe(false);
  });
});

describe("readTexts", () => {
  it("lets a person embed one question", () => {
    expect(readTexts({ texts: ["What is an SIP?"] }, "person")).toEqual(["What is an SIP?"]);
    expect(readTexts({ texts: ["a", "b"] }, "person")).toBeNull();
    expect(readTexts({ texts: ["x".repeat(MAX_QUESTION_CHARS)] }, "person")).not.toBeNull();
    expect(readTexts({ texts: ["x".repeat(MAX_QUESTION_CHARS + 1)] }, "person")).toBeNull();
  });

  it("lets the service role embed a batch of passages within the chunk limit", () => {
    expect(readTexts({ texts: Array(MAX_BATCH).fill("p") }, "service")).toHaveLength(MAX_BATCH);
    expect(readTexts({ texts: Array(MAX_BATCH + 1).fill("p") }, "service")).toBeNull();
    expect(readTexts({ texts: ["x".repeat(MAX_PASSAGE_CHARS + 1)] }, "service")).toBeNull();
  });

  it("refuses empty, blank and malformed bodies", () => {
    for (const body of [null, [], "x", {}, { texts: [] }, { texts: "x" }, { texts: [" "] }, { texts: [1] }]) {
      expect(readTexts(body, "service")).toBeNull();
    }
  });
});

describe("readRequestId", () => {
  it("reads a uuid and nothing else", () => {
    expect(readRequestId({ request_id: REQUEST_ID })).toBe(REQUEST_ID);
    for (const body of [null, {}, { request_id: "1" }, { request_id: 1 }, { request_id: `${REQUEST_ID}x` }]) expect(readRequestId(body)).toBeNull();
  });
});

describe("tokenKind", () => {
  it("names a key prefix or a JWT's role, nothing else", () => {
    const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.s`;
    expect(tokenKind(null)).toBe("none");
    expect(tokenKind("sb_secret_xyz")).toBe("sb_secret");
    expect(tokenKind("sb_publishable_xyz")).toBe("sb_publishable");
    expect(tokenKind(jwt({ role: "service_role", sub: "x" }))).toBe("jwt:service_role");
    expect(tokenKind(jwt({ role: "Robert'); drop" }))).toBe("jwt:unknown");
    expect(tokenKind("a.!!!.c")).toBe("jwt:unreadable");
    expect(tokenKind("plain")).toBe("other");
  });
});

describe("serviceKeys", () => {
  it("takes the legacy key and every secret key, and ignores a dictionary that is not JSON", async () => {
    const keys = serviceKeys("legacy-jwt", JSON.stringify({ default: "sb_secret_one", ingest: "sb_secret_two", bad: 3 }));
    expect(keys).toEqual(["legacy-jwt", "sb_secret_one", "sb_secret_two"]);
    expect(serviceKeys(undefined, "not json")).toEqual([]);
    expect(serviceKeys("legacy-jwt", undefined)).toEqual(["legacy-jwt"]);
    expect(await isServiceKey("sb_secret_two", keys)).toBe(true);
    expect(await isServiceKey("legacy-jwt", keys)).toBe(true);
    expect(await isServiceKey("someone-else", keys)).toBe(false);
    expect(await isServiceKey("anything", [])).toBe(false);
  });
});

const reason = async (response: Response) => ((await response.json()) as { reason?: string }).reason;

describe("handleRequest", () => {
  it("answers 401 without a token and never embeds", async () => {
    const { d, seen } = deps(false);
    expect((await handleRequest(post(question("q"), null), d)).status).toBe(401);
    expect(seen).toEqual([]);
  });

  it("lets a person embed only inside an open question that roma_knowledge_embed accepts", async () => {
    const ok = deps(false, true);
    const response = await handleRequest(post(question("What is an SIP?")), ok.d);
    expect(response.status).toBe(200);
    expect(ok.asked).toEqual([REQUEST_ID]);
    expect(ok.seen).toEqual(["What is an SIP?"]);

    const refused = deps(false, false);
    expect((await handleRequest(post(question("q")), refused.d)).status).toBe(403);
    expect(refused.seen).toEqual([]);
  });

  it("answers 403 when the question check throws (signed out, bad token, database down)", async () => {
    const { d, seen } = deps(false);
    d.allowQuestion = async () => {
      throw new Error("down");
    };
    expect((await handleRequest(post(question("q")), d)).status).toBe(403);
    expect(seen).toEqual([]);
  });

  it("refuses a person's call without a question id, before any check", async () => {
    const { d, asked } = deps(false);
    expect((await handleRequest(post({ texts: ["q"] }), d)).status).toBe(400);
    expect((await handleRequest(post({ texts: ["q"], request_id: "nope" }), d)).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("treats a failing service check as a person", async () => {
    const { d } = deps(false);
    d.isService = async () => {
      throw new Error("x");
    };
    const response = await handleRequest(post({ texts: ["q"] }), d);
    expect(response.status).toBe(400);
    expect(await reason(response)).toBe("request_id_missing");
  });

  it("says an unknown key was taken for a person before any person limit, with only the token's kind", async () => {
    const { d, logs } = deps(false);
    // Built from parts so the repository's secret check does not take the fake key for a real one.
    const response = await handleRequest(post({ texts: ["a", "b", "c"] }, ["sb", "secret", "abcdef123456"].join("_")), d);
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, string>;
    expect(body).toEqual({ error: "invalid_request", reason: "request_id_missing", seen_as_person: "bearer sb_secret, apikey none" });
    expect(JSON.stringify(body) + logs.join()).not.toContain("abcdef123456");
  });

  it("takes the service role from the apikey header when the bearer is not a service key", async () => {
    const { d, asked } = deps(false);
    d.isService = async (token) => token === "the-service-key";
    const request = new Request("https://example.test/functions/v1/embed", {
      method: "POST",
      headers: { Authorization: "Bearer some.platform.jwt", apikey: "the-service-key" },
      body: JSON.stringify({ texts: ["one", "two", "three"] }),
    });
    const response = await handleRequest(request, d);
    expect(response.status).toBe(200);
    expect(asked).toEqual([]);
  });

  it("names the rule a body broke, never the text", async () => {
    const service = deps(true).d;
    const cases: [unknown, string][] = [
      ["{not json", "body_not_json"],
      [{ texts: [] }, "texts_missing"],
      [{ passages: ["p"] }, "texts_missing"],
      [{ texts: Array(MAX_BATCH + 1).fill("p") }, "too_many_texts"],
      [{ texts: ["  "] }, "text_empty_or_not_string"],
      [{ texts: ["secret words " + "x".repeat(MAX_PASSAGE_CHARS)] }, "text_too_long"],
    ];
    for (const [body, expected] of cases) {
      const response = await handleRequest(post(body), service);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: "invalid_request", reason: expected });
      expect(text).not.toContain("secret words");
    }
  });

  it("refuses other methods and bad bodies", async () => {
    const { d } = deps(false);
    expect((await handleRequest(new Request("https://example.test/", { method: "GET" }), d)).status).toBe(405);
    expect((await handleRequest(post("{not json"), d)).status).toBe(400);
    expect((await handleRequest(post({ texts: ["a", "b"], request_id: REQUEST_ID }), d)).status).toBe(400);
  });

  it("returns one vector per passage to the service role, in order, without a question check", async () => {
    const { d, seen, asked } = deps(true);
    const response = await handleRequest(post({ texts: ["one", "two"] }), d);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { embeddings: number[][] };
    expect(body.embeddings).toHaveLength(2);
    expect(body.embeddings[0]).toHaveLength(DIMENSIONS);
    expect(seen).toEqual(["one", "two"]);
    expect(asked).toEqual([]);
  });

  it("fails without leaking the text when the model returns a bad vector or throws", async () => {
    for (const embed of [async () => VECTOR.slice(1), async () => [...VECTOR.slice(1), Number.NaN], async () => Promise.reject(new TypeError("secret question"))]) {
      const { d, logs } = deps(false, true, embed);
      const response = await handleRequest(post(question("secret question")), d);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("secret");
      expect(logs.join(" ")).not.toContain("secret");
    }
  });
});
