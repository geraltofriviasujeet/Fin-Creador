import AsyncStorage from "@react-native-async-storage/async-storage";
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { type Cipher, createEncryptedStorage } from "./encrypted-storage";

// The AES-256 key lives in the Keychain / Android Keystore, readable after first unlock
// (so token refresh works with the screen locked) and never migrated to another device.
const KEY_NAME = "fin-creador.session-key";
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

async function loadCipher(): Promise<Cipher> {
  const stored = await SecureStore.getItemAsync(KEY_NAME, KEY_OPTIONS);
  let key: AESEncryptionKey;
  if (stored) {
    key = await AESEncryptionKey.import(stored, "base64");
  } else {
    key = await AESEncryptionKey.generate();
    await SecureStore.setItemAsync(KEY_NAME, await key.encoded("base64"), KEY_OPTIONS);
  }
  return {
    encrypt: async (plaintext) => (await aesEncryptAsync(plaintext, key)).combined("base64"),
    decrypt: (sealed) => aesDecryptAsync(AESSealedData.fromCombined(sealed), key),
  };
}

let cipher: Promise<Cipher> | undefined;

function getCipher(): Promise<Cipher> {
  cipher ??= loadCipher().catch((error: unknown) => {
    cipher = undefined; // retry on the next call
    throw error;
  });
  return cipher;
}

/** Storage adapter for supabase-js: AsyncStorage, AES-GCM encrypted. */
export const sessionStorage = createEncryptedStorage(AsyncStorage, getCipher);
