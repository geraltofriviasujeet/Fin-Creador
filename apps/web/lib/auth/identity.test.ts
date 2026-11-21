import { describe, expect, it } from "vitest"
import { avatarInitials, maskEmail } from "./identity"

describe("maskEmail", () => {
  it.each([
    ["asha.patel@example.com", "a•••@example.com"],
    ["x@example.in", "x•••@example.in"],
    ["first.last+tag@mail.example.co.uk", "f•••@mail.example.co.uk"],
  ])("%s → %s", (email, masked) => {
    expect(maskEmail(email)).toBe(masked)
  })

  it("masks malformed addresses entirely", () => {
    for (const email of ["", "no-at-sign", "@example.com", "name@"]) expect(maskEmail(email)).toBe("•••")
  })
})

describe("avatarInitials", () => {
  it("takes up to two initials from the name", () => {
    expect(avatarInitials("Asha Patel", "a@example.com")).toBe("AP")
    expect(avatarInitials("  asha   devi patel ", "a@example.com")).toBe("AD")
    expect(avatarInitials("Asha", "a@example.com")).toBe("A")
  })

  it("falls back to the email's first letter, then to ?", () => {
    expect(avatarInitials(null, "zoe@example.com")).toBe("Z")
    expect(avatarInitials("   ", "zoe@example.com")).toBe("Z")
    expect(avatarInitials(null, "")).toBe("?")
  })
})
