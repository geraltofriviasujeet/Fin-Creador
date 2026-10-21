import { defineConfig } from "vitest/config";

// Single shared Vitest config for pure TypeScript units across the monorepo.
// UI/integration test setups get their own config when they are introduced.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/web/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    environment: "node",
  },
});
