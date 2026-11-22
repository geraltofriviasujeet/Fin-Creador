import { describe, expect, it } from "vitest"
import { visualViewportVars } from "./use-visual-viewport"

describe("visualViewportVars", () => {
  it("publishes the visible height and offset in whole pixels", () => {
    expect(visualViewportVars({ height: 412.6, offsetTop: 0 })).toEqual({ "--fc-vvh": "413px", "--fc-vv-top": "0px" })
  })
  it("follows iOS panning the visual viewport down to the focused input", () => {
    expect(visualViewportVars({ height: 380, offsetTop: 220.4 })).toEqual({ "--fc-vvh": "380px", "--fc-vv-top": "220px" })
  })
  it("never publishes a negative offset (rubber-band overscroll)", () => {
    expect(visualViewportVars({ height: 780, offsetTop: -12 })["--fc-vv-top"]).toBe("0px")
  })
})
