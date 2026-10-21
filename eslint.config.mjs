// Root config: lints shared packages and root config files.
// apps/web and apps/mobile have their own configs (run via their `lint` scripts).
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import { sharedIgnores, sharedRules } from "./eslint.shared.mjs";

export default defineConfig([
  globalIgnores([...sharedIgnores, "apps/**"]),
  ...tseslint.configs.recommended,
  sharedRules,
]);
