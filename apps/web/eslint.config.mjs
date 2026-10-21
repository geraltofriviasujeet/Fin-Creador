import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { sharedIgnores, sharedRules } from "../../eslint.shared.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  sharedRules,
  globalIgnores([...sharedIgnores, "out/**"]),
]);

export default eslintConfig;
