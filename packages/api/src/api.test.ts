import { describe, expect, it } from "vitest"
import {
  authErrorMessage,
  INVALID_TIME_ZONE_CODE,
  isExistingAccountError,
  ledgerErrorMessage,
  isSafePublicKey,
  profileFormValues,
  profileUpdateColumns,
  SIGN_UP_CHECK_EMAIL,
} from "./index"

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

describe("isExistingAccountError (no account enumeration on sign-up)", () => {
  it.each(["user_already_exists", "email_exists"])("treats %s as an existing account", (code) => {
    expect(isExistingAccountError({ code, status: 422 })).toBe(true)
  })

  it.each([{ code: "weak_password" }, { code: "over_email_send_rate_limit", status: 429 }, { status: 500 }, null, undefined])(
    "leaves other errors alone: %j",
    (error) => {
      expect(isExistingAccountError(error)).toBe(false)
    }
  )

  it("uses one shared answer for new and existing emails", () => {
    expect(SIGN_UP_CHECK_EMAIL).toBe("Check your email for a link to confirm your account, then sign in.")
  })
})

describe("isSafePublicKey", () => {
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

  it("decodes unpadded base64url payloads", () => {
    const payload = btoa(JSON.stringify({ role: "anon", x: "??" })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
    expect(isSafePublicKey(["e30", payload, "sig"].join("."))).toBe(true)
  })
})

describe("profile mapping", () => {
  it("prefills form values, canonicalizing legacy time zones and blank optionals", () => {
    expect(
      profileFormValues({ display_name: null, phone: null, country: "IN", currency: "INR", time_zone: "Asia/Calcutta" })
    ).toEqual({ displayName: "", phone: "", country: "IN", currency: "INR", timeZone: "Asia/Kolkata" })
  })

  it("maps validated input to exactly the five updatable columns", () => {
    const columns = profileUpdateColumns({
      displayName: "Asha",
      phone: "+919876543210",
      country: "IN",
      currency: "INR",
      timeZone: "Asia/Kolkata",
    })
    expect(Object.keys(columns).sort()).toEqual(["country", "currency", "display_name", "phone", "time_zone"])
    expect(columns.display_name).toBe("Asha")
  })

  it("matches the trigger's invalid time zone code", () => {
    expect(INVALID_TIME_ZONE_CODE).toBe("22023")
  })
})

describe("ledgerErrorMessage", () => {
  it.each([
    ["FC001", "accountId"],
    ["FC004", "currency"],
    ["FC006", "sourceId"],
    ["FC011", "openingBalanceDate"],
    ["FC015", "counterAccountId"],
    ["FC016", "paymentMode"],
    ["FC022", "endDate"],
  ])("maps %s to a friendly message on %s", (code, field) => {
    const m = ledgerErrorMessage({ code, message: "raw database text" })
    expect(m.field).toBe(field)
    expect(m.message).not.toContain("raw database text")
  })

  it.each(["FC014", "FC017", "FC018", "FC019", "FC020", "FC021", "FC023"])("maps %s to a friendly message", (code) => {
    expect(ledgerErrorMessage({ code, message: "raw database text" }).message).not.toMatch(/raw database text|couldn’t save/)
  })

  it("puts a future-date error on the form's own date field", () => {
    expect(ledgerErrorMessage({ code: "FC003" }, { dateField: "occurredOn" }).field).toBe("occurredOn")
  })

  it("maps a duplicate source name and falls back to a generic message", () => {
    expect(ledgerErrorMessage({ code: "23505" })).toEqual({ message: "You already have a source with this name.", field: "name" })
    expect(ledgerErrorMessage({ code: "XX000", message: "secret detail" }).message).toBe("We couldn’t save that. Please try again.")
  })
})
