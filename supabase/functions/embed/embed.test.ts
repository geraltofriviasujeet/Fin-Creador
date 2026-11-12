import { describe, expect, it } from "vitest";
import { DIMENSIONS, MAX_BATCH, MAX_PASSAGE_CHARS, MAX_QUESTION_CHARS, bearer, handleRequest, readTexts, sameKey, type Caller, type Deps } from "./embed.ts";

const VECTOR = Array.from({ length: DIMENSIONS }, (_, i) => i / DIMENSIONS);

function deps(caller: Caller | null, embed: (text: string) => Promise<number[]> = async () => VECTOR) {
  const logs: string[] = [];
  const seen: string[] = [];
  const d: Deps = {
    caller: async () => caller,
    embed: async (text) => {
      seen.push(text);
      return embed(text);
    },
    log: (line) => logs.push(line),
  };
  return { d, logs, seen };
}

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

describe("handleRequest", () => {
  it("answers 401 without a known caller and never embeds", async () => {
    for (const [caller, token] of [[null, "t"], ["person", null]] as const) {
      const { d, seen } = deps(caller);
      const response = await handleRequest(post({ texts: ["q"] }, token), d);
      expect(response.status).toBe(401);
      expect(seen).toEqual([]);
    }
  });

  it("answers 401 when the caller check throws", async () => {
    const { d } = deps("person");
    d.caller = async () => {
      throw new Error("auth down");
    };
    expect((await handleRequest(post({ texts: ["q"] }), d)).status).toBe(401);
  });

  it("refuses other methods and bad bodies", async () => {
    const { d } = deps("person");
    expect((await handleRequest(new Request("https://example.test/", { method: "GET" }), d)).status).toBe(405);
    expect((await handleRequest(post("{not json"), d)).status).toBe(400);
    expect((await handleRequest(post({ texts: ["a", "b"] }), d)).status).toBe(400);
  });

  it("returns one vector per text, in order", async () => {
    const { d, seen } = deps("service");
    const response = await handleRequest(post({ texts: ["one", "two"] }), d);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { embeddings: number[][] };
    expect(body.embeddings).toHaveLength(2);
    expect(body.embeddings[0]).toHaveLength(DIMENSIONS);
    expect(seen).toEqual(["one", "two"]);
  });

  it("fails without leaking the text when the model returns a bad vector or throws", async () => {
    for (const embed of [async () => VECTOR.slice(1), async () => [...VECTOR.slice(1), Number.NaN], async () => Promise.reject(new TypeError("secret question"))]) {
      const { d, logs } = deps("person", embed);
      const response = await handleRequest(post({ texts: ["secret question"] }), d);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("secret");
      expect(logs.join(" ")).not.toContain("secret");
    }
  });
});
