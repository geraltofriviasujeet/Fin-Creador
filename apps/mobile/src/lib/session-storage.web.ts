import type { KeyValueStore } from "./encrypted-storage";

// Expo web only (Metro picks this file over session-storage.ts for the web platform). The web
// export exists only for CI's Playwright checks; users get the Next.js web app. Expo web has
// no Keychain/Keystore (expo-secure-store is empty there), so the session sits in this tab's
// sessionStorage: kept across reloads, gone when the tab closes. Native builds never include
// this file.
export const sessionStorage: KeyValueStore = {
  getItem: async (key) => window.sessionStorage.getItem(key),
  setItem: async (key, value) => window.sessionStorage.setItem(key, value),
  removeItem: async (key) => window.sessionStorage.removeItem(key),
};
