import { describe, expect, it } from "vitest"
import { greeting } from "./greeting"

// 03:30 UTC is 09:00 in Kolkata, 22:30 the day before in New York.
const AT = new Date("2026-11-06T03:30:00Z")

describe("greeting", () => {
  it("uses the person's own time zone for the part of day", () => {
    expect(greeting("Asha Rao", "Asia/Kolkata", AT)).toBe("Good morning, Asha")
    expect(greeting("Asha Rao", "America/New_York", AT)).toBe("Good evening, Asha")
    expect(greeting("Asha", "Asia/Kolkata", new Date("2026-11-06T08:30:00Z"))).toBe("Good afternoon, Asha")
  })

  it("switches at 12:00 and 17:00", () => {
    expect(greeting(null, "UTC", new Date("2026-11-06T11:59:00Z"))).toBe("Good morning")
    expect(greeting(null, "UTC", new Date("2026-11-06T12:00:00Z"))).toBe("Good afternoon")
    expect(greeting(null, "UTC", new Date("2026-11-06T17:00:00Z"))).toBe("Good evening")
  })

  it("drops the name when it is missing or blank", () => {
    expect(greeting(null, "Asia/Kolkata", AT)).toBe("Good morning")
    expect(greeting("   ", "Asia/Kolkata", AT)).toBe("Good morning")
  })
})
