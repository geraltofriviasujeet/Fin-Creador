import { describe, expect, it } from "vitest"
import { shortDate } from "./format"

describe("shortDate", () => {
  it("formats a calendar date without shifting it", () => {
    expect(shortDate("2028-02-29")).toBe("29 Feb 2028")
  })
})
