import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INCOME_TAX_2026_27, type TaxSlab, salaryTaxEstimate, taxOnTaxableIncome } from "../packages/domain/src/income-tax";

// 10.6e: the tax estimate may use only what the approved regime documents state. Every value in
// INCOME_TAX_2026_27 is traced here to the sentence that states it, the slab lists are read from
// the documents, and each worked example is rebuilt from the function's output and must appear
// in its document word for word. Changing a document or the table without the other fails here.

const read = (slug: string) => readFileSync(fileURLToPath(new URL(`../supabase/knowledge/${slug}.md`, import.meta.url)), "utf8");
const NEW_DOC = read("income-tax-new-regime-2026-27");
const OLD_DOC = read("income-tax-old-regime-2026-27");
const CHOICE_DOC = read("old-or-new-tax-regime-2026-27");

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const rupees = (s: string) => Number(s.replace(/[₹,]/g, ""));

/** The bullet list of slabs that follows `heading` in a document. */
function slabsAfter(doc: string, heading: string): TaxSlab[] {
  const start = doc.indexOf(heading);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const lines = doc.slice(start + heading.length).split("\n").map((l) => l.trim());
  const first = lines.findIndex((l) => l.startsWith("- "));
  const bullets = lines.slice(first, lines.findIndex((l, i) => i > first && !l.startsWith("- ")));
  return bullets.map((line) => {
    const rate = /: (nil|\d+%)$/.exec(line)?.[1];
    const ratePct = rate === "nil" ? 0 : Number(rate?.replace("%", ""));
    const upTo = /^- Up to (₹[\d,]+):/.exec(line);
    if (upTo) return { from: 0, upTo: rupees(upTo[1]!), ratePct };
    const band = /^- (₹[\d,]+) to (₹[\d,]+):/.exec(line);
    if (band) return { from: rupees(band[1]!) - 1, upTo: rupees(band[2]!), ratePct };
    const above = /^- Above (₹[\d,]+):/.exec(line);
    if (above) return { from: rupees(above[1]!), upTo: null, ratePct };
    throw new Error(`Unread slab line: ${line}`);
  });
}

describe("the rates table traces to the approved documents", () => {
  it("both documents are approved and for tax year 2026-27", () => {
    for (const doc of [NEW_DOC, OLD_DOC, CHOICE_DOC]) {
      expect(doc).toMatch(/^status: approved$/m);
      expect(doc).toMatch(/^financial_year: 2026-27$/m);
    }
  });

  it("slabs are the documents' lists", () => {
    expect(INCOME_TAX_2026_27.new.slabs.under_60).toEqual(slabsAfter(NEW_DOC, "## The rates"));
    expect(INCOME_TAX_2026_27.old.slabs.under_60).toEqual(slabsAfter(OLD_DOC, "Under 60:"));
    expect(INCOME_TAX_2026_27.old.slabs["60_to_79"]).toEqual(slabsAfter(OLD_DOC, "Resident aged 60 to 79:"));
    expect(INCOME_TAX_2026_27.old.slabs["80_plus"]).toEqual(slabsAfter(OLD_DOC, "Resident aged 80 or more:"));
  });

  // Each value, and the sentence in an approved document that states it.
  const n = INCOME_TAX_2026_27.new;
  const o = INCOME_TAX_2026_27.old;
  it.each([
    ["new standard deduction", n.standardDeduction, 75_000, NEW_DOC, "Salaried people deduct ₹75,000 (or the salary, if less) under section 19."],
    ["old standard deduction", o.standardDeduction, 50_000, OLD_DOC, "The standard deduction on salary is ₹50,000 (section 19)"],
    ["new rebate limit", n.rebate.incomeUpTo, 1_200_000, NEW_DOC, "whose total income is up to ₹12,00,000 gets a rebate of the whole tax, up to ₹60,000"],
    ["new rebate", n.rebate.max, 60_000, NEW_DOC, "gets a rebate of the whole tax, up to ₹60,000 (section 156(2))"],
    ["new rebate relief", n.rebate.reliefAbove, true, NEW_DOC, "Just above ₹12,00,000, the rebate makes sure the tax is never more than the income above ₹12,00,000."],
    ["old rebate limit", o.rebate.incomeUpTo, 500_000, OLD_DOC, "a resident individual whose total income is up to ₹5,00,000 gets a rebate of the tax, up to ₹12,500."],
    ["old rebate", o.rebate.max, 12_500, OLD_DOC, "gets a rebate of the tax, up to ₹12,500."],
    // The old regime document states no relief above ₹5,00,000.
    ["old rebate relief", o.rebate.reliefAbove, false, OLD_DOC, "The income is above ₹5,00,000, so there is no rebate."],
    ["new surcharge", n.surcharge, [{ above: 5_000_000, ratePct: 10 }, { above: 10_000_000, ratePct: 15 }, { above: 20_000_000, ratePct: 25 }], NEW_DOC, "10% above ₹50 lakh up to ₹1 crore; 15% above ₹1 crore up to ₹2 crore; 25% above ₹2 crore. Under these rates surcharge never goes above 25%"],
    ["old surcharge", o.surcharge, [{ above: 5_000_000, ratePct: 10 }, { above: 10_000_000, ratePct: 15 }, { above: 20_000_000, ratePct: 25 }, { above: 50_000_000, ratePct: 37 }], OLD_DOC, "10% above ₹50 lakh up to ₹1 crore; 15% above ₹1 crore up to ₹2 crore; 25% above ₹2 crore up to ₹5 crore; 37% above ₹5 crore."],
    ["new cess", n.cessPct, 4, NEW_DOC, "Health and education cess: 4% of the tax plus surcharge."],
    ["old cess", o.cessPct, 4, OLD_DOC, "Health and education cess: 4% of the tax plus surcharge."],
    ["marginal relief (new)", true, true, NEW_DOC, "Marginal relief: just above each surcharge threshold, the tax plus surcharge cannot exceed the tax plus surcharge at the threshold by more than the income above it."],
    ["marginal relief (old)", true, true, OLD_DOC, "Marginal relief: just above each surcharge threshold, the tax plus surcharge cannot exceed the tax plus surcharge at the threshold by more than the income above it."],
  ] as const)("%s", (_name, value, expected, doc, sentence) => {
    expect(value).toEqual(expected);
    expect(doc).toContain(sentence);
  });
});

describe("the documents' worked examples match the function", () => {
  it("new regime: salary ₹13,00,000 (rebate relief)", () => {
    const t = salaryTaxEstimate({ grossSalary: 1_300_000, ageBand: "under_60" }).new;
    expect(NEW_DOC).toContain(`Salary ₹13,00,000. Taxable income after the standard deduction: ${inr(t.taxableIncome)}.`);
    expect(NEW_DOC).toContain(`15% of ₹25,000 (₹3,750) = ${inr(t.slabTax)}.`);
    expect(NEW_DOC).toContain(`so the rebate is ${inr(t.slabTax)} − ₹25,000 = ${inr(t.rebate)} and the tax is ${inr(t.taxAfterRebate)}. Cess ${inr(t.cess)}; total ${inr(t.total)}.`);
  });

  it("new regime: salary ₹12,75,000 (nil)", () => {
    const t = salaryTaxEstimate({ grossSalary: 1_275_000, ageBand: "under_60" }).new;
    expect(t.total).toBe(0);
    expect(NEW_DOC).toContain(`Salary ₹12,75,000. Taxable income ${inr(t.taxableIncome)}; tax ${inr(t.slabTax)}; rebate ${inr(t.rebate)}; tax nil, so no cess.`);
  });

  it("new regime: salary ₹15,00,000 (no rebate)", () => {
    const t = salaryTaxEstimate({ grossSalary: 1_500_000, ageBand: "under_60" }).new;
    expect(t.rebate).toBe(0);
    expect(NEW_DOC).toContain(`Salary ₹15,00,000. Taxable income ${inr(t.taxableIncome)}; tax ${inr(t.slabTax)}. The income above ₹12,00,000 (₹2,25,000) is more than the tax, so there is no rebate. Cess ${inr(t.cess)}; total ${inr(t.total)}.`);
  });

  it("old regime: under 60, taxable ₹5,00,000 (rebate)", () => {
    const t = taxOnTaxableIncome("old", 500_000, "under_60");
    expect(t.total).toBe(0);
    expect(t.rebate).toBe(t.slabTax);
    expect(OLD_DOC).toContain(`Under 60, taxable income ₹5,00,000. Tax: 5% of ₹2,50,000 = ${inr(t.slabTax)}, fully cancelled by the rebate: nil.`);
  });

  it("old regime: under 60, taxable ₹9,25,000", () => {
    const t = taxOnTaxableIncome("old", 925_000, "under_60");
    expect(OLD_DOC).toContain(`Under 60, taxable income ₹9,25,000. Tax: 5% of ₹2,50,000 (₹12,500) + 20% of ₹4,25,000 (₹85,000) = ${inr(t.slabTax)}. The income is above ₹5,00,000, so there is no rebate. Cess ${inr(t.cess)}; total ${inr(t.total)}.`);
  });

  it("old regime: taxable ₹7,00,000 at 60 to 79 and at 80 or more", () => {
    const mid = taxOnTaxableIncome("old", 700_000, "60_to_79");
    const top = taxOnTaxableIncome("old", 700_000, "80_plus");
    expect(OLD_DOC).toContain(`Aged 60 to 79: 5% of ₹2,00,000 (₹10,000) + 20% of ₹2,00,000 (₹40,000) = ${inr(mid.slabTax)}. Cess ${inr(mid.cess)}; total ${inr(mid.total)}.`);
    expect(OLD_DOC).toContain(`Aged 80 or more: 20% of ₹2,00,000 = ${inr(top.slabTax)}. Cess ${inr(top.cess)}; total ${inr(top.total)}.`);
  });

  it("old regime: under 60, taxable ₹51,00,000 (surcharge marginal relief)", () => {
    const t = taxOnTaxableIncome("old", 5_100_000, "under_60");
    expect(OLD_DOC).toContain(`Under 60, taxable income ₹51,00,000. Tax: ₹1,12,500 + 30% of ₹41,00,000 (₹12,30,000) = ${inr(t.slabTax)}. Surcharge at 10% would be ${inr(t.surcharge + t.surchargeRelief)}.`);
    expect(OLD_DOC).toContain(`so tax plus surcharge is capped at ${inr(t.taxAfterRebate + t.surcharge)}: marginal relief cuts the surcharge to ${inr(t.surcharge)}. Cess ${inr(t.cess)}; total ${inr(t.total)}.`);
  });

  it("the choice document: salary ₹12,00,000 with ₹2,25,000 of deductions", () => {
    const e = salaryTaxEstimate({ grossSalary: 1_200_000, ageBand: "under_60", oldRegimeDeductions: 225_000 });
    expect(e.new.total).toBe(0);
    expect(CHOICE_DOC).toContain(`Default rates: taxable income ₹12,00,000 − ₹75,000 = ${inr(e.new.taxableIncome)}. Tax ${inr(e.new.slabTax)}, fully cancelled by the rebate: nil, so no cess.`);
    expect(CHOICE_DOC).toContain(`= ${inr(e.old.taxableIncome)}. This is above ₹5,00,000, so the old regime's rebate does not apply. Under 60, tax is 5% of ₹2,50,000 (₹12,500) + 20% of ₹4,25,000 (₹85,000) = ${inr(e.old.slabTax)}. Cess ${inr(e.old.cess)}; total ${inr(e.old.total)}.`);
    expect(e.lower).toBe("new");
    expect(CHOICE_DOC).toContain(`Here the default rates are lower by ${inr(e.difference)}.`);
  });
});
