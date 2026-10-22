import { describe, expect, it } from "vitest"
import { findSecrets, isForbiddenEnvFile, mask, printableText } from "./secret-scan.mjs"

// Fixtures are assembled at runtime so this file never contains anything that looks like
// a real secret (the repo scan would rightly flag it).
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
const jwt = (payload: object) => ["eyJhbGciOiJIUzI1NiJ9", b64(payload), "c2lnbmF0dXJlLXZhbHVl"].join(".")
const sbSecret = ["sb", "secret", "AbCdEfGhIjKlMnOp"].join("_")
const googleSecret = ["GOCSPX", "aBcDeFgHiJkLmNoPqRsT"].join("-")
const privateKey = ["-----BEGIN", "PRIVATE KEY-----"].join(" ")

describe("findSecrets", () => {
  it.each([
    ["Supabase secret key", `const k = "${sbSecret}"`],
    ["Google OAuth client secret", `secret=${googleSecret}`],
    ["Private key", privateKey],
    ["JWT (role: service_role)", jwt({ role: "service_role", iss: "supabase" })],
    ["JWT (role: none)", jwt({ sub: "user-id", exp: 1 })],
  ])("flags %s", (kind, text) => {
    expect(findSecrets(text).map((f) => f.kind)).toContain(kind)
  })

  it("allows the public anon JWT, publishable keys and the bare guard prefix", () => {
    const text = [jwt({ role: "anon", iss: "supabase" }), "sb_publishable_AbCdEfGhIjKlMnOp", 'key.startsWith("sb_secret_")'].join("\n")
    expect(findSecrets(text)).toEqual([])
  })

  it("finds canary values and never returns the secret itself", () => {
    const canary = "canary-value-that-must-not-ship"
    const findings = findSecrets(`a ${canary} b ${canary}`, { canaries: [canary] })
    expect(findings).toHaveLength(2)
    expect(JSON.stringify(findings)).not.toContain(canary)
  })
})

describe("helpers", () => {
  it("masks values", () => {
    expect(mask(sbSecret)).not.toContain(sbSecret)
    expect(mask("short")).toBe("***")
  })

  it("extracts printable strings from binary bundles", () => {
    const buffer = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`x=${sbSecret};`), Buffer.from([0, 255])])
    expect(findSecrets(printableText(buffer))).toHaveLength(1)
  })

  it.each([
    [".env", true],
    ["apps/web/.env.local", true],
    ["apps/mobile/.env.production", true],
    ["apps/mobile/.env.example", false],
    ["docs/env.md", false],
  ])("treats %s as forbidden: %s", (path, forbidden) => {
    expect(isForbiddenEnvFile(path)).toBe(forbidden)
  })
})
