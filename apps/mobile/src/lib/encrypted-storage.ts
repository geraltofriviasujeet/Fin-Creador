// Encrypted key-value storage for the Supabase session. Pure TypeScript (no React Native
// imports) so it is unit tested in Node; session-storage.ts wires in AsyncStorage,
// expo-crypto (AES-GCM) and expo-secure-store.
//
// Why: the secure store (Keychain / Android Keystore) can hold only small values, and a
// session is several KB, so the session lives in AsyncStorage encrypted with a 256-bit
// key that itself lives in the secure store (Supabase's recommended pattern).

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type Cipher = {
  /** Returns the sealed value (IV + ciphertext + tag) as base64. */
  encrypt(plaintext: Uint8Array): Promise<string>;
  /** Throws if the value was not sealed with this key or was tampered with. */
  decrypt(sealed: string): Promise<Uint8Array>;
};

export function createEncryptedStorage(store: KeyValueStore, getCipher: () => Promise<Cipher>): KeyValueStore {
  return {
    async getItem(key) {
      const sealed = await store.getItem(key);
      if (sealed === null) return null;
      // A failure to load the key (e.g. secure store briefly unavailable) propagates, so a
      // valid session is never thrown away by mistake.
      const cipher = await getCipher();
      try {
        return utf8Decode(await cipher.decrypt(sealed));
      } catch {
        // Sealed with a key we no longer have (reinstall, restored backup) or corrupted:
        // unrecoverable, so drop it and the user signs in again.
        await store.removeItem(key);
        return null;
      }
    },
    async setItem(key, value) {
      const cipher = await getCipher();
      await store.setItem(key, await cipher.encrypt(utf8Encode(value)));
    },
    async removeItem(key) {
      await store.removeItem(key);
    },
  };
}

// UTF-8 without TextEncoder/TextDecoder, which Hermes does not fully provide.
// Session JSON can contain non-ASCII (e.g. a display name in user metadata).

export function utf8Encode(text: string): Uint8Array {
  const escaped = encodeURIComponent(text);
  const bytes: number[] = [];
  for (let i = 0; i < escaped.length; i++) {
    if (escaped[i] === "%") {
      bytes.push(parseInt(escaped.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(escaped.charCodeAt(i));
    }
  }
  return Uint8Array.from(bytes);
}

export function utf8Decode(bytes: Uint8Array): string {
  let escaped = "";
  for (const byte of bytes) escaped += `%${byte.toString(16).padStart(2, "0")}`;
  return decodeURIComponent(escaped);
}
