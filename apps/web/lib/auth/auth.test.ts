import { describe, expect, it } from "vitest"
import { parsePublicEnv } from "../env"
import { authCallbackUrl, rootCodeHandoff, safeNextPath } from "./redirect"
import { answersSignedOutAction, decideRoute, routeKind } from "./routes"

describe("safeNextPath (open-redirect guard)", () => {
  it.each([
    ["/settings", "/settings"],
    ["/settings?tab=profile#tz", "/settings?tab=profile#tz"],
    ["/", "/"],
  ])("allows same-site path %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected)
  })

  it.each([
    null,
    undefined,
    "",
    "settings",
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "/\r\nSet-Cookie:x",
    "/\tevil",
    "/auth/callback?next=/",
  ])("falls back to / for %j", (input) => {
    expect(safeNextPath(input)).toBe("/")
  })

  it("keeps percent-encoded characters encoded (same-site, cannot split headers)", () => {
    const result = safeNextPath("/%0d%0aSet-Cookie:x")
    expect(result.startsWith("/")).toBe(true)
    expect(result).not.toMatch(/[\r\n]/)
  })

  it("uses the provided fallback", () => {
    expect(safeNextPath("//evil", "/sign-in")).toBe("/sign-in")
  })
})

describe("auth callback URL", () => {
  it("is built from the site URL and matches the <site>/auth/callback** allow-list entry", () => {
    const url = authCallbackUrl("https://app.example/", "/settings")
    expect(url).toBe("https://app.example/auth/callback?next=%2Fsettings")
    expect(url.startsWith("https://app.example/auth/callback")).toBe(true)
  })

  it("never carries an off-site next", () => {
    expect(authCallbackUrl("https://app.example", "https://evil.example")).toBe("https://app.example/auth/callback?next=%2F")
  })
})

describe("root ?code handoff", () => {
  const code = "6f1c2b9e-3a4d-4c5e-9f00-1234567890ab"

  it("sends a root code to the callback, signed in or out", () => {
    expect(rootCodeHandoff("/", `?code=${code}`)).toBe(`/auth/callback?code=${code}`)
    expect(decideRoute("/", `?code=${code}`, false)).toEqual({ redirectTo: `/auth/callback?code=${code}` })
    expect(decideRoute("/", `?code=${code}`, true)).toEqual({ redirectTo: `/auth/callback?code=${code}` })
  })

  it("forwards only the code, so nothing else in the query picks the destination", () => {
    expect(rootCodeHandoff("/", `?code=${code}&next=https://evil.example`)).toBe(`/auth/callback?code=${code}`)
  })

  it.each(["", "?code=", "?code=a/b", "?code=%2F%2Fevil.example", "?code=a%3Fnext%3D%2F%2Fevil", `?code=${"a".repeat(257)}`])(
    "ignores a missing or malformed code %j",
    (search) => {
      expect(rootCodeHandoff("/", search)).toBeNull()
    }
  )

  it("only applies at the site root", () => {
    expect(rootCodeHandoff("/settings", `?code=${code}`)).toBeNull()
  })
})

describe("route rules", () => {
  it("classifies routes", () => {
    expect(routeKind("/sign-in")).toBe("auth")
    expect(routeKind("/update-password")).toBe("recovery")
    expect(routeKind("/auth/callback")).toBe("public")
    expect(routeKind("/settings")).toBe("protected")
    expect(routeKind("/")).toBe("protected")
    expect(routeKind("/sign-in-extra")).toBe("protected")
  })

  it("sends signed-out users to sign-in, keeping where they were going", () => {
    expect(decideRoute("/settings", "?tab=1", false)).toEqual({
      redirectTo: "/sign-in?next=%2Fsettings%3Ftab%3D1",
    })
    expect(decideRoute("/", "", false)).toEqual({ redirectTo: "/sign-in" })
  })

  it("sends signed-in users away from auth pages", () => {
    expect(decideRoute("/sign-up", "", true)).toEqual({ redirectTo: "/" })
  })

  it("requires a session for the password update page", () => {
    expect(decideRoute("/update-password", "", false)).toEqual({
      redirectTo: "/forgot-password?notice=link-expired",
    })
    expect(decideRoute("/update-password", "", true)).toBeNull()
  })

  it("never redirects the auth callback", () => {
    expect(decideRoute("/auth/callback", "?code=x", false)).toBeNull()
    expect(decideRoute("/auth/callback", "?code=x", true)).toBeNull()
  })

  it("lets signed-in users into the app", () => {
    expect(decideRoute("/settings", "", true)).toBeNull()
  })

  it("has no sign-in exception for the removed prototype, in any build", () => {
    expect(routeKind("/dev/transactions")).toBe("protected")
    expect(decideRoute("/dev/transactions", "", false)).toEqual({ redirectTo: "/sign-in?next=%2Fdev%2Ftransactions" })
    expect(decideRoute("/transactions", "?q=rent", false)).toEqual({ redirectTo: "/sign-in?next=%2Ftransactions%3Fq%3Drent" })
  })

  it("has no sign-in exception for the removed recurring prototype", () => {
    expect(routeKind("/dev/recurring")).toBe("protected")
    expect(decideRoute("/recurring", "", false)).toEqual({ redirectTo: "/sign-in?next=%2Frecurring" })
  })
})

describe("signed-out server actions", () => {
  it("only the statement import's actions answer a signed-out caller themselves", () => {
    expect(answersSignedOutAction("/loans-liabilities/import", "POST", true)).toBe(true)
    expect(answersSignedOutAction("/loans-liabilities/import", "GET", false)).toBe(false)
    expect(answersSignedOutAction("/loans-liabilities/import", "POST", false)).toBe(false)
    expect(answersSignedOutAction("/loans-liabilities/import/x", "POST", true)).toBe(false)
  })

  it("every other protected page and its actions still redirect to sign-in", () => {
    for (const path of ["/transactions", "/loans-liabilities", "/income", "/settings"]) {
      expect(answersSignedOutAction(path, "POST", true)).toBe(false)
      expect(decideRoute(path, "", false)).toEqual({ redirectTo: `/sign-in?next=${encodeURIComponent(path)}` })
    }
  })
})

describe("public env guard", () => {
  // Assembled at runtime so the repo secret scan never sees a key-shaped literal.
  const fakeSecretKey = ["sb", "secret", "DO_NOT_LEAK"].join("_")

  it("names the variable without echoing values, and trims the site URL", () => {
    expect(() =>
      parsePublicEnv({ supabaseUrl: "https://x.supabase.co", supabasePublishableKey: fakeSecretKey, siteUrl: "http://localhost:3000" })
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/)
    try {
      parsePublicEnv({ supabaseUrl: "https://x.supabase.co", supabasePublishableKey: fakeSecretKey, siteUrl: "x" })
    } catch (e) {
      expect(String(e)).not.toContain("DO_NOT_LEAK")
    }
    expect(
      parsePublicEnv({ supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "sb_publishable_a", siteUrl: "http://localhost:3000/" }).siteUrl
    ).toBe("http://localhost:3000")
  })
})
