import { defineConfig, globalIgnores } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";
import { sharedIgnores, sharedRules } from "../../eslint.shared.mjs";

// Hermes on iOS has a partial Intl (no formatToParts; date parts come back as one string), so
// screens format dates, times and money through packages/domain, never Intl or toLocale*.
const hermesSafeFormatting = {
  files: ["src/app/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "MemberExpression[object.name='Intl']",
        message: "Hermes on iOS has a partial Intl. Use the formatters in @fin-creador/domain.",
      },
      {
        selector: "CallExpression[callee.property.name=/^toLocale/]",
        message: "toLocale* depends on Hermes' Intl. Use the formatters in @fin-creador/domain.",
      },
    ],
  },
};

export default defineConfig([
  expoConfig,
  sharedRules,
  hermesSafeFormatting,
  globalIgnores([...sharedIgnores, "ios/**", "android/**"]),
]);
