import { describe, expect, it } from "vitest";
import { DUE_KINDS } from "./due-items";
import { statutoryDueState } from "./statutory";

describe("statutoryDueState", () => {
  it("unpaid, part paid with what is left, paid once covered", () => {
    expect(statutoryDueState(50_000_00, 0)).toEqual({ state: "unpaid", leftMinor: 50_000_00 });
    expect(statutoryDueState(50_000_00, 20_000_00)).toEqual({ state: "part_paid", leftMinor: 30_000_00 });
    expect(statutoryDueState(50_000_00, 50_000_00)).toEqual({ state: "paid", leftMinor: 0 });
  });

  it("refuses a zero amount or bad figures", () => {
    expect(() => statutoryDueState(0, 0)).toThrow(RangeError);
    expect(() => statutoryDueState(100, -1)).toThrow(RangeError);
    expect(() => statutoryDueState(1.5, 0)).toThrow(RangeError);
  });

  it("is a due kind", () => {
    expect(DUE_KINDS).toContain("statutory_due");
  });
});
