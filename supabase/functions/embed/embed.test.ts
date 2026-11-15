import { describe, expect, it } from "vitest";
import { DIMENSIONS, MAX_BATCH, MAX_PASSAGE_CHARS, MAX_QUESTION_CHARS, bearer, envKeyKind, handleRequest, platformServiceCheck, tokenKind, readRequestId, readTexts, type Deps } from "./embed.ts";

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

// An unsigned JWT: anyone can write one with any claims.
const unsignedJwt = (payload: object) =>
  [{ alg: "none", typ: "JWT" }, payload].map((part) => btoa(JSON.stringify(part)).replace(/=+$/, "")).join(".") + ".";

// Stands in for the Auth admin API: 200 only for the project's real service key.
function platform(validKey: string) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    return new Response("{}", { status: headers.apikey === validKey ? 200 : 401 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("envKeyKind", () => {
  it("names only the kind of key", () => {
    expect(envKeyKind(undefined)).toBe("missing");
    expect(envKeyKind("")).toBe("missing");
    expect(envKeyKind(["sb", "secret", "abc"].join("_"))).toBe("sb_secret");
    expect(envKeyKind("a.b.c")).toBe("jwt");
    expect(envKeyKind("plain")).toBe("other");
  });
});

describe("platformServiceCheck", () => {
  const serviceJwt = `${unsignedJwt({ role: "service_role", ref: "dev" })}signed-by-the-project`;

  it("accepts a service token the platform verifies, asks once per token, and sends it to the admin API only", async () => {
    const { fetcher, calls } = platform(serviceJwt);
    const check = platformServiceCheck("https://project.example.test/", fetcher);
    expect(await check(serviceJwt)).toBe(true);
    expect(await check(serviceJwt)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://project.example.test/auth/v1/admin/users?page=1&per_page=1");
    expect(calls[0]!.headers).toEqual({ apikey: serviceJwt, Authorization: `Bearer ${serviceJwt}` });
  });

  it("sends a secret key as apikey only", async () => {
    const key = ["sb", "secret", "abcdef123456"].join("_");
    const { fetcher, calls } = platform(key);
    expect(await platformServiceCheck("https://p.test", fetcher)(key)).toBe(true);
    expect(calls[0]!.headers).toEqual({ apikey: key });
  });

  it("refuses a forged unsigned JWT that claims the service role", async () => {
    const { fetcher, calls } = platform(serviceJwt);
    const forged = unsignedJwt({ role: "service_role", ref: "dev" });
    expect(await platformServiceCheck("https://p.test", fetcher)(forged)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("never sends a person's token, and a network failure is not the service role", async () => {
    const { fetcher, calls } = platform(serviceJwt);
    expect(await platformServiceCheck("https://p.test", fetcher)(unsignedJwt({ role: "authenticated", sub: "u" }))).toBe(false);
    expect(calls).toEqual([]);
    const down = platformServiceCheck("https://p.test", (async () => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch);
    await expect(down(serviceJwt)).rejects.toThrow();
  });
});

describe("handleRequest with the platform check", () => {
  const serviceJwt = `${unsignedJwt({ role: "service_role" })}signed-by-the-project`;
  const wired = (validKey: string) => {
    const { d, asked, seen } = deps(false);
    const { fetcher, calls } = platform(validKey);
    d.isService = platformServiceCheck("https://p.test", fetcher);
    return { d, asked, seen, calls };
  };
  const passages = { texts: ["one", "two", "three"] };

  it("embeds a batch for a verified service token", async () => {
    const { d, asked } = wired(serviceJwt);
    expect((await handleRequest(post(passages, serviceJwt), d)).status).toBe(200);
    expect(asked).toEqual([]);
  });

  it("treats a forged service-role JWT as a person without a question", async () => {
    const { d, seen } = wired(serviceJwt);
    const response = await handleRequest(post(passages, unsignedJwt({ role: "service_role" })), d);
    expect(response.status).toBe(400);
    expect(await reason(response)).toBe("request_id_missing");
    expect(seen).toEqual([]);
  });

  it("still needs a request id from a person, and checks it with their token", async () => {
    const { d, asked, calls } = wired(serviceJwt);
    const person = unsignedJwt({ role: "authenticated", sub: "u" });
    expect(await reason(await handleRequest(post({ texts: ["q"] }, person), d))).toBe("request_id_missing");
    expect((await handleRequest(post(question("q"), person), d)).status).toBe(200);
    expect(asked).toEqual([REQUEST_ID]);
    expect(calls).toEqual([]);
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
