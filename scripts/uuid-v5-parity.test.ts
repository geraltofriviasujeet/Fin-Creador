import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { uuidV5 } from "../packages/domain/src/uuid-v5"

// packages/domain uuidV5 (pure SHA-1, for Hermes) against Node's SHA-1, for names of every padding
// length and with multi-byte UTF-8 (₹, emoji, accents).
const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

function reference(name: string, namespace: string): string {
  const hash = createHash("sha1").update(Buffer.from(namespace.replace(/-/g, ""), "hex")).update(name, "utf8").digest().subarray(0, 16)
  hash[6] = (hash[6]! & 0x0f) | 0x50
  hash[8] = (hash[8]! & 0x3f) | 0x80
  const hex = hash.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

describe("uuidV5 parity", () => {
  it("matches Node's SHA-1", () => {
    for (let n = 0; n < 140; n++) {
      const name = "₹a|😀é".repeat(n).slice(0, n)
      expect(uuidV5(name, DNS)).toBe(reference(name, DNS))
    }
  })
})
