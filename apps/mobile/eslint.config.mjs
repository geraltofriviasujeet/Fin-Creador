import { defineConfig, globalIgnores } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";
import { sharedIgnores, sharedRules } from "../../eslint.shared.mjs";

export default defineConfig([
  expoConfig,
  sharedRules,
  globalIgnores([...sharedIgnores, "ios/**", "android/**"]),
]);
