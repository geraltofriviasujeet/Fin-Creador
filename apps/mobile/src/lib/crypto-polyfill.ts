import { CryptoDigestAlgorithm, digest, getRandomValues, randomUUID } from "expo-crypto";

// Hermes has no WebCrypto. Without it supabase-js builds the PKCE verifier with
// Math.random() and sends a "plain" challenge. This fills in the parts it uses, backed
// by expo-crypto (native secure random and SHA digests). Import before the Supabase client.

type DigestInput = Parameters<typeof digest>[1];
type MinimalCrypto = {
  getRandomValues?: typeof getRandomValues;
  randomUUID?: () => string;
  subtle?: { digest?: (algorithm: string | { name: string }, data: DigestInput) => Promise<ArrayBuffer> };
};

const ALGORITHMS: Record<string, CryptoDigestAlgorithm> = {
  "SHA-1": CryptoDigestAlgorithm.SHA1,
  "SHA-256": CryptoDigestAlgorithm.SHA256,
  "SHA-384": CryptoDigestAlgorithm.SHA384,
  "SHA-512": CryptoDigestAlgorithm.SHA512,
};

type CryptoScope = { crypto?: MinimalCrypto };

/**
 * Fills in getRandomValues, randomUUID and subtle.digest where missing. The guard is
 * `crypto?.getRandomValues`, not `crypto`: an environment can expose a partial crypto object
 * (e.g. randomUUID only), and that one still needs the polyfill. An existing object is patched
 * in place (browsers, for Expo web, where window.crypto is read-only); a frozen partial object
 * is replaced by one that also carries its own methods.
 */
export function installCryptoPolyfill(scope: CryptoScope = globalThis as unknown as CryptoScope): void {
  const existing = scope.crypto;
  const target: MinimalCrypto = existing && Object.isExtensible(existing) ? existing : { ...existing };

  target.getRandomValues ??= getRandomValues;
  target.randomUUID ??= randomUUID;
  if (!target.subtle?.digest) {
    target.subtle = {
      ...target.subtle,
      digest: (algorithm, data) => {
        const name = (typeof algorithm === "string" ? algorithm : algorithm.name).toUpperCase();
        const mapped = ALGORITHMS[name];
        if (!mapped) return Promise.reject(new Error(`Unsupported digest algorithm: ${name}`));
        return digest(mapped, data);
      },
    };
  }

  if (!scope.crypto?.getRandomValues) {
    try {
      scope.crypto = target;
    } catch {
      Object.defineProperty(scope, "crypto", { value: target, configurable: true, writable: true });
    }
  }
}

installCryptoPolyfill();
