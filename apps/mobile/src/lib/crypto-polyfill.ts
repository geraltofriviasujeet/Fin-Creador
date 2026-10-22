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

const scope = globalThis as unknown as { crypto?: MinimalCrypto };
const target: MinimalCrypto = scope.crypto ?? {};

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
scope.crypto = target;
