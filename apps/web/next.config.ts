import type { NextConfig } from "next";

// This build's id for the service worker (Sprint 12b, components/pwa/service-worker.tsx): each
// deploy registers /sw.js?v=<id>, so its caches are versioned. Vercel's commit SHA, or the
// build time locally and in CI.
const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || `build-${Date.now().toString(36)}`

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION },
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@fin-creador/api", "@fin-creador/domain", "@fin-creador/schemas", "@fin-creador/design-tokens"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
