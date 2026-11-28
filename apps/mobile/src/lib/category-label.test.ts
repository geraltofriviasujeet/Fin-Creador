import { describe, expect, it } from "vitest";
import { categoryLabelSize } from "./category-label";

describe("categoryLabelSize", () => {
  it("keeps 12px for names that wrap onto two lines", () => {
    for (const name of ["Food & dining", "Bank charges & interest", "Rent & housing", "Education", "Gift", "Utilities & bills"]) expect(categoryLabelSize(name)).toBe(12);
  });

  it("drops to 11px only for a single word too long for the tile", () => {
    expect(categoryLabelSize("Entertainment")).toBe(11);
    expect(categoryLabelSize("Subscription")).toBe(11);
    expect(categoryLabelSize("Membership")).toBe(12);
  });
});
