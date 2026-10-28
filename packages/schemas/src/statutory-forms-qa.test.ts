import { describe, expect, it } from "vitest";
import { firstFieldErrors } from "./form-errors";
import {
  STATUTORY_DESCRIPTION_MAX,
  STATUTORY_DIGITS,
  statutoryDueEditFormSchema,
  statutoryDueFormSchema,
} from "./statutory-forms";

// QA regression tests for Sprint 8d: digits in any script, in the description (a run of 4) and
// in the state and city (any digit). The database refuses the same values (statutory_dues_qa.test.sql).

const KEY = "e8000000-0000-4000-8000-0000000000e1";
const DUE = "f8000000-0000-4000-8000-0000000000e1";
const schema = statutoryDueFormSchema({ currency: "INR", accounts: [] });
const edit = statutoryDueEditFormSchema({
  currency: "INR",
  accounts: [],
  dueType: "fine",
  paidMinor: 0,
});
const base = {
  dueType: "fine",
  amount: "100",
  dueDate: "2026-10-20",
  description: "",
  vehicleKind: "",
  issuedState: "",
  issuedCity: "",
  payFromAccountId: "",
  idempotencyKey: KEY,
};
const cp = (...c: number[]) => String.fromCodePoint(...c);

function errors(result: { success: boolean; error?: unknown }) {
  return result.success
    ? {}
    : firstFieldErrors(result.error as Parameters<typeof firstFieldErrors>[0]);
}

// Four digits of one script, then a mixed run, then separated digits (not a run).
const FOUR_DIGITS: Record<string, string> = {
  ascii: "1234",
  "arabic-indic": cp(0x661, 0x662, 0x663, 0x664),
  "extended arabic-indic": cp(0x6f1, 0x6f2, 0x6f3, 0x6f4),
  devanagari: cp(0x967, 0x968, 0x969, 0x96a),
  bengali: cp(0x9e7, 0x9e8, 0x9e9, 0x9ea),
  tamil: cp(0xbe7, 0xbe8, 0xbe9, 0xbea),
  telugu: cp(0xc67, 0xc68, 0xc69, 0xc6a),
  kannada: cp(0xce7, 0xce8, 0xce9, 0xcea),
  thai: cp(0xe51, 0xe52, 0xe53, 0xe54),
  fullwidth: cp(0xff11, 0xff12, 0xff13, 0xff14),
  "mathematical bold (astral)": cp(0x1d7cf, 0x1d7d0, 0x1d7d1, 0x1d7d2),
  superscripts: cp(0xb2, 0xb3, 0xb9, 0x2074),
  subscripts: cp(0x2081, 0x2082, 0x2083, 0x2084),
  "mixed scripts": `1${cp(0x968, 0xff13, 0x664)}`,
};

describe("statutory description: a run of 4 digits, any script", () => {
  for (const [script, digits] of Object.entries(FOUR_DIGITS)) {
    it(`refuses 4 digits (${script}) in a description, on add and on edit`, () => {
      expect(
        errors(schema.safeParse({ ...base, description: `Challan ${digits}` })),
      ).toEqual({ description: STATUTORY_DIGITS });
      expect(
        errors(
          edit.safeParse({
            statutoryDueId: DUE,
            amount: "100",
            dueDate: "2026-10-20",
            description: `${digits} ref`,
          }),
        ),
      ).toEqual({ description: STATUTORY_DIGITS });
    });
    it(`allows 3 digits (${script}) in a description`, () => {
      const three = [...digits].slice(0, 3).join("");
      expect(
        schema.safeParse({ ...base, description: `Q ${three}` }).success,
      ).toBe(true);
    });
  }

  it("allows digits that are not a run, and a run split by a letter or space", () => {
    expect(schema.safeParse({ ...base, description: "FY 12 34" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ ...base, description: "123 4" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ ...base, description: "12a34" }).success).toBe(
      true,
    );
  });

  it("applies the length limit after collapsing spaces: 120 is allowed, 121 is not", () => {
    expect(
      schema.safeParse({
        ...base,
        description: "a".repeat(STATUTORY_DESCRIPTION_MAX),
      }).success,
    ).toBe(true);
    expect(
      errors(
        schema.safeParse({
          ...base,
          description: "a".repeat(STATUTORY_DESCRIPTION_MAX + 1),
        }),
      ),
    ).toHaveProperty("description");
  });
});

describe("statutory state and city: any single digit is refused", () => {
  const one = [
    cp(0x31),
    cp(0x968),
    cp(0x663),
    cp(0xff14),
    cp(0xb2),
    cp(0x2082),
    cp(0x1d7d3),
  ];
  for (const d of one) {
    it(`refuses U+${d.codePointAt(0)!.toString(16).toUpperCase()} in a state and in a city`, () => {
      expect(
        errors(schema.safeParse({ ...base, issuedState: `Karnataka ${d}` })),
      ).toEqual({
        issuedState: "Choose a state or union territory from the list",
      });
      expect(
        errors(schema.safeParse({ ...base, issuedCity: `Bengaluru${d}` })),
      ).toEqual({ issuedCity: "Choose a city from the list" });
      expect(
        errors(
          edit.safeParse({
            statutoryDueId: DUE,
            amount: "100",
            dueDate: "2026-10-20",
            issuedState: `${d}Karnataka`,
          }),
        ),
      ).toEqual({
        issuedState: "Choose a state or union territory from the list",
      });
    });
  }

  it("takes listed places on a fine and drops them on other types", () => {
    const fine = schema.safeParse({
      ...base,
      issuedState: "Karnataka",
      issuedCity: "Bengaluru",
    });
    expect(
      fine.success && [fine.data.issuedState, fine.data.issuedCity],
    ).toEqual(["Karnataka", "Bengaluru"]);
    const tax = schema.safeParse({
      ...base,
      dueType: "income_tax",
      issuedState: "Karnataka 1",
      issuedCity: "Gotham",
    });
    expect(tax.success && [tax.data.issuedState, tax.data.issuedCity]).toEqual([
      null,
      null,
    ]);
  });
});
