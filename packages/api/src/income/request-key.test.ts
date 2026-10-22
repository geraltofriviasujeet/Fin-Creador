// Runs in Vitest (Node).
/// <reference types="node" />
import { describe, expect, it } from "vitest"
import { newRequestKey } from "./request-key"

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("newRequestKey", () => {
  it("returns a v4 UUID", () => {
    expect(newRequestKey()).toMatch(UUID_V4)
  })

  it("falls back to getRandomValues outside secure contexts", () => {
    const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(crypto), "randomUUID")
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true })
    try {
      const keys = new Set(Array.from({ length: 50 }, newRequestKey))
      expect(keys.size).toBe(50)
      for (const k of keys) expect(k).toMatch(UUID_V4)
    } finally {
      delete (crypto as { randomUUID?: unknown }).randomUUID
      expect(typeof crypto.randomUUID).toBe(original ? "function" : "undefined")
    }
  })
})
