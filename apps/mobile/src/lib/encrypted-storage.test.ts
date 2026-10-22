// Runs in Vitest (Node), not in the app.
/// <reference types="node" />
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type Cipher, type KeyValueStore, createEncryptedStorage, utf8Decode, utf8Encode } from "./encrypted-storage";

// Real AES-256-GCM (Node WebCrypto) standing in for expo-crypto, same sealed layout:
// 12-byte IV + ciphertext + 16-byte tag, base64.
async function aesCipher(): Promise<Cipher> {
  const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return {
    async encrypt(plaintext) {
      const iv = webcrypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
      return Buffer.concat([iv, sealed]).toString("base64");
    },
    async decrypt(value) {
      const bytes = Buffer.from(value, "base64");
      const plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
      return new Uint8Array(plain);
    },
  };
}

function memoryStore(): KeyValueStore & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: async (k) => raw.get(k) ?? null,
    setItem: async (k, v) => void raw.set(k, v),
    removeItem: async (k) => void raw.delete(k),
  };
}

const SESSION = JSON.stringify({ access_token: "header.payload.sig", user: { user_metadata: { display_name: "Ánanya 🌿" } } });

describe("utf8", () => {
  it.each(["", "plain ascii", "Ánanya", "₹ 1,00,000", "🌿 emoji", "हिन्दी"])("matches TextEncoder for %j", (s) => {
    expect(utf8Encode(s)).toEqual(new TextEncoder().encode(s));
    expect(utf8Decode(new TextEncoder().encode(s))).toBe(s);
  });
});

describe("createEncryptedStorage", () => {
  it("round-trips a session and never stores it in plain text", async () => {
    const store = memoryStore();
    const cipher = await aesCipher();
    const storage = createEncryptedStorage(store, async () => cipher);

    await storage.setItem("sb-session", SESSION);
    const stored = store.raw.get("sb-session") ?? "";
    expect(stored).not.toContain("access_token");
    expect(stored).not.toContain("header.payload.sig");
    expect(await storage.getItem("sb-session")).toBe(SESSION);
  });

  it("returns null for a missing key", async () => {
    const storage = createEncryptedStorage(memoryStore(), aesCipher);
    expect(await storage.getItem("nothing")).toBeNull();
  });

  it("drops a value sealed with another key (e.g. after reinstall) instead of failing forever", async () => {
    const store = memoryStore();
    const oldKey = await aesCipher();
    await createEncryptedStorage(store, async () => oldKey).setItem("sb-session", SESSION);

    const newKey = await aesCipher();
    const storage = createEncryptedStorage(store, async () => newKey);
    expect(await storage.getItem("sb-session")).toBeNull();
    expect(store.raw.has("sb-session")).toBe(false);
  });

  it("drops a tampered value", async () => {
    const store = memoryStore();
    const cipher = await aesCipher();
    const storage = createEncryptedStorage(store, async () => cipher);
    await storage.setItem("sb-session", SESSION);
    const bytes = Buffer.from(store.raw.get("sb-session") ?? "", "base64");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    store.raw.set("sb-session", bytes.toString("base64"));
    expect(await storage.getItem("sb-session")).toBeNull();
  });

  it("keeps the stored session when the key cannot be loaded", async () => {
    const store = memoryStore();
    const cipher = await aesCipher();
    await createEncryptedStorage(store, async () => cipher).setItem("sb-session", SESSION);

    const unavailable = createEncryptedStorage(store, async () => {
      throw new Error("secure store unavailable");
    });
    await expect(unavailable.getItem("sb-session")).rejects.toThrow("secure store unavailable");
    expect(store.raw.has("sb-session")).toBe(true);
  });

  it("removes values", async () => {
    const store = memoryStore();
    const storage = createEncryptedStorage(store, aesCipher);
    await storage.setItem("k", "v");
    await storage.removeItem("k");
    expect(store.raw.size).toBe(0);
  });
});
