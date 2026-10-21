import { describe, expect, it } from "vitest"
import { isSafePublicKey, parsePublicEnv } from "../env"
import { authErrorMessage } from "./errors"
import { safeNextPath } from "./redirect"
import { decideRoute, routeKind } from "./routes"

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
})

describe("authErrorMessage", () => {
  it("does not reveal whether an account exists", () => {
    expect(authErrorMessage({ code: "invalid_credentials" }).message).toBe("Email or password is incorrect.")
  })

  it("flags unconfirmed email so the UI can offer a resend", () => {
    expect(authErrorMessage({ code: "email_not_confirmed" }).code).toBe("email_not_confirmed")
  })

  it("attaches password problems to the password field", () => {
    expect(authErrorMessage({ code: "weak_password" }).field).toBe("password")
    expect(authErrorMessage({ code: "same_password" }).field).toBe("password")
  })

  it("handles rate limits by code or status", () => {
    expect(authErrorMessage({ code: "over_email_send_rate_limit" }).message).toMatch(/Too many attempts/)
    expect(authErrorMessage({ status: 429 }).message).toMatch(/Too many attempts/)
  })

  it("falls back to a generic message for unknown errors", () => {
    expect(authErrorMessage({ code: "something_new" }).message).toBe("Something went wrong. Please try again.")
    expect(authErrorMessage(undefined).message).toBe("Something went wrong. Please try again.")
  })
})

describe("public env guard", () => {
  const jwt = (payload: object) =>
    ["e30", btoa(JSON.stringify(payload)).replace(/=+$/, ""), "sig"].join(".")

  it("accepts publishable and legacy anon keys", () => {
    expect(isSafePublicKey("sb_publishable_abc123")).toBe(true)
    expect(isSafePublicKey(jwt({ role: "anon" }))).toBe(true)
  })

  it("rejects secret and service-role keys", () => {
    expect(isSafePublicKey("sb_secret_abc123")).toBe(false)
    expect(isSafePublicKey(jwt({ role: "service_role" }))).toBe(false)
    expect(isSafePublicKey("random-string")).toBe(false)
  })

  it("names the variable without echoing values, and trims the site URL", () => {
    expect(() =>
      parsePublicEnv({ supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "sb_secret_DO_NOT_LEAK", siteUrl: "http://localhost:3000" })
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/)
    try {
      parsePublicEnv({ supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "sb_secret_DO_NOT_LEAK", siteUrl: "x" })
    } catch (e) {
      expect(String(e)).not.toContain("DO_NOT_LEAK")
    }
    expect(
      parsePublicEnv({ supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "sb_publishable_a", siteUrl: "http://localhost:3000/" }).siteUrl
    ).toBe("http://localhost:3000")
  })
})
