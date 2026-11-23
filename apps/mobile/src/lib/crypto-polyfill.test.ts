// Runs in Vitest (Node), not in the app. expo-crypto is native, so it is replaced here.
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA1: "SHA-1", SHA256: "SHA-256", SHA384: "SHA-384", SHA512: "SHA-512" },
  getRandomValues: vi.fn(<T>(array: T) => array),
  randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000000"),
  digest: vi.fn(async () => new ArrayBuffer(32)),
}));

const { installCryptoPolyfill } = await import("./crypto-polyfill");
const expoCrypto = await import("expo-crypto");

type Scope = Parameters<typeof installCryptoPolyfill>[0];

describe("crypto polyfill", () => {
  it("installs crypto when there is none", () => {
    const scope: NonNullable<Scope> = {};
    installCryptoPolyfill(scope);
    expect(scope.crypto?.getRandomValues).toBe(expoCrypto.getRandomValues);
    expect(scope.crypto?.randomUUID).toBe(expoCrypto.randomUUID);
    expect(typeof scope.crypto?.subtle?.digest).toBe("function");
  });

  it("fills a partial crypto object that has no getRandomValues", () => {
    const ownUUID = () => "own";
    const scope: NonNullable<Scope> = { crypto: { randomUUID: ownUUID } };
    installCryptoPolyfill(scope);
    expect(scope.crypto?.getRandomValues).toBe(expoCrypto.getRandomValues);
    expect(scope.crypto?.randomUUID).toBe(ownUUID); // existing methods are kept
    expect(typeof scope.crypto?.subtle?.digest).toBe("function");
  });

  it("replaces a frozen partial crypto object, keeping its methods", () => {
    const ownUUID = () => "own";
    const scope: NonNullable<Scope> = { crypto: Object.freeze({ randomUUID: ownUUID }) };
    installCryptoPolyfill(scope);
    expect(scope.crypto?.getRandomValues).toBe(expoCrypto.getRandomValues);
    expect(scope.crypto?.randomUUID).toBe(ownUUID);
  });

  it("leaves a complete crypto object (browsers) in place", () => {
    const full = {
      getRandomValues: vi.fn(),
      randomUUID: () => "browser",
      subtle: { digest: vi.fn(async () => new ArrayBuffer(0)) },
    };
    const scope: NonNullable<Scope> = {};
    Object.defineProperty(scope, "crypto", { value: full, writable: false, enumerable: true }); // read-only like window.crypto
    expect(() => installCryptoPolyfill(scope)).not.toThrow();
    expect(scope.crypto).toBe(full);
    expect(scope.crypto?.getRandomValues).toBe(full.getRandomValues);
    expect(scope.crypto?.subtle?.digest).toBe(full.subtle.digest);
  });

  it("maps digest algorithm names to expo-crypto", async () => {
    const scope: NonNullable<Scope> = {};
    installCryptoPolyfill(scope);
    await scope.crypto?.subtle?.digest?.("sha-256", new Uint8Array([1]));
    expect(expoCrypto.digest).toHaveBeenCalledWith("SHA-256", new Uint8Array([1]));
    await expect(scope.crypto?.subtle?.digest?.("MD5", new Uint8Array([1]))).rejects.toThrow("Unsupported");
  });
});
