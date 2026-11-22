import { offlinePageHtml } from "@/lib/pwa/offline-page"

// The offline page (Sprint 12b): one static, self-contained document with no personal data
// (lib/pwa/offline-page.ts). Built once at build time; the service worker precaches it.
// proxy.ts skips this path, so no session cookie is read or set.

export function GET() {
  return new Response(offlinePageHtml(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
