import { describe, expect, it } from "vitest";
import { uuidV5 } from "./uuid-v5";

// Parity with Node's SHA-1 for many name lengths: scripts/uuid-v5-parity.test.ts.
const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("uuidV5", () => {
  it("matches the published example (www.example.com in the DNS namespace)", () => {
    expect(uuidV5("www.example.com", DNS)).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("refuses a namespace that is not a UUID", () => {
    expect(() => uuidV5("x", "not-a-uuid")).toThrow(RangeError);
  });
});
