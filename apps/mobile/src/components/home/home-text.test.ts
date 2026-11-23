import { describe, expect, it } from "vitest";
import { initials } from "./home-text";

describe("initials", () => {
  it("takes up to two initials, or none without a name", () => {
    expect(initials("Asha Rao Kumar")).toBe("AR");
    expect(initials("  asha ")).toBe("A");
    expect(initials(null)).toBeNull();
    expect(initials("   ")).toBeNull();
  });
});
