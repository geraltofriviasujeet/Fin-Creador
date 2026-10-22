// Idempotency key for creating income. One per opened form or sheet; kept when a save
// fails (so the retry can't double-post) and replaced only after a successful save.
// randomUUID() exists only in secure contexts (HTTPS, localhost) and, on mobile, via the
// expo-crypto polyfill; getRandomValues() works everywhere.
export function newRequestKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
