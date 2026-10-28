import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DIGIT_RANGES, hasDigitRun } from "../packages/schemas/src/digits";

// public.has_digit (migration 20261028210000) and hasDigitRun in packages/schemas must count the
// same characters as digits: the ranges in the migration's regular expression are compared with
// DIGIT_RANGES, and hasDigitRun is checked against DIGIT_RANGES for every code point.

const MIGRATION = fileURLToPath(new URL("../supabase/migrations/20261028210000_borrowing_details_card_products.sql", import.meta.url));

function sqlRanges(): [number, number][] {
  const sql = readFileSync(MIGRATION, "utf8");
  const body = sql.slice(sql.indexOf("create function public.has_digit"), sql.indexOf("comment on function public.has_digit"));
  const klass = [...body.matchAll(/'([^']*)'/g)]
    .map((m) => m[1])
    .filter((s) => s !== "[" && !s.startsWith("]"))
    .join("");
  const code = String.raw`\\u([0-9A-F]{4})|\\U([0-9A-F]{8})`;
  const ranges = [...klass.matchAll(new RegExp(`(?:${code})(?:-(?:${code}))?`, "g"))].map((m) => {
    const a = parseInt(m[1] ?? m[2], 16);
    const b = m[3] ?? m[4] ? parseInt((m[3] ?? m[4]) as string, 16) : a;
    return [a, b] as [number, number];
  });
  return ranges;
}

const inRanges = (c: number) => DIGIT_RANGES.some(([a, b]) => c >= a && c <= b);

describe("has_digit parity", () => {
  it("the migration and packages/schemas list the same ranges", () => {
    expect(sqlRanges()).toEqual(DIGIT_RANGES.map(([a, b]) => [a, b]));
  });

  it("hasDigitRun counts exactly the listed characters, and every \\p{Nd} this runtime knows", () => {
    const wrong: number[] = [];
    const nd = /\p{Nd}/u;
    for (let c = 0; c <= 0x10ffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const ch = String.fromCodePoint(c);
      const listed = inRanges(c);
      if (hasDigitRun(ch) !== listed || (nd.test(ch) && !listed)) wrong.push(c);
    }
    expect(wrong).toEqual([]);
  }, 60_000);

  it("runs mix scripts", () => {
    expect(hasDigitRun(`1${String.fromCodePoint(0x967)}${String.fromCodePoint(0xff13)}${String.fromCodePoint(0x664)}`, 4)).toBe(true);
    expect(hasDigitRun(`12 ${String.fromCodePoint(0x967)}${String.fromCodePoint(0xff13)}`, 3)).toBe(false);
    expect(hasDigitRun("6E Rewards XL", 3)).toBe(false);
    expect(hasDigitRun("x²")).toBe(true);
  });
});
