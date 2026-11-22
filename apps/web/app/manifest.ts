import type { MetadataRoute } from "next"
import { colors } from "@fin-creador/design-tokens"

// The web app manifest (Sprint 12b): installs FinCreador to a home screen. Icons from
// scripts/generate-pwa-assets.ts. Shortcuts use the existing deep links: ?add=expense opens the
// Add expense sheet (lib/use-add-deep-link.ts), /roma opens Roma.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "FinCreador",
    short_name: "FinCreador",
    description: "Your personal financial operating system: record spending, see your balances and plan ahead.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: colors.canvas,
    background_color: colors.nav,
    lang: "en-IN",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Add expense", short_name: "Add expense", url: "/transactions?add=expense", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Ask Roma", short_name: "Ask Roma", url: "/roma", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  }
}
