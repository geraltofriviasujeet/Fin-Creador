// Income tax on salary for tax year 2026-27 (Sprint 10.6e): a resident individual with salary
// income only, under both regimes. Every value in INCOME_TAX_2026_27 is stated in an approved
// knowledge document (supabase/knowledge/income-tax-new-regime-2026-27.md and
// income-tax-old-regime-2026-27.md); income-tax.test.ts reads those documents and fails if a
// rate, threshold or worked example disagrees. Nothing here comes from anywhere else.
//
// Order: standard deduction (never more than the salary) and old-regime deductions → taxable
// income (never below zero) → tax per slab → rebate, and under the new regime its relief just
// above ₹12,00,000 (the tax is never more than the income above it) → surcharge and its
// marginal relief at each threshold → 4% cess on tax plus surcharge.
//
// Arithmetic is exact: amounts are bigint millionths of a rupee (slab rates and surcharge are
// whole percentages, cess 4%, so every step divides exactly). The documents don't state how a
// result that isn't a whole rupee is rounded, so each figure is shown to the nearest rupee
// (half up) and `wholeRupees` says when any was not whole.

export const TAX_YEAR_2026_27 = "2026-27";

export type TaxRegime = "new" | "old";
export type TaxAgeBand = "under_60" | "60_to_79" | "80_plus";

/** A band of income taxed at `ratePct`: from `from` + 1 up to `upTo` rupees (no `upTo`: no limit). */
export type TaxSlab = { from: number; upTo: number | null; ratePct: number };
/** Surcharge at `ratePct` of the tax on income above `above` rupees. */
export type SurchargeBand = { above: number; ratePct: number };

type RegimeRules = {
  standardDeduction: number;
  slabs: Record<TaxAgeBand, readonly TaxSlab[]>;
  /** A rebate of the whole tax, up to `max`, when taxable income is at most `incomeUpTo`. */
  rebate: { incomeUpTo: number; max: number; reliefAbove: boolean };
  surcharge: readonly SurchargeBand[];
  cessPct: number;
};

const NEW_SLABS: readonly TaxSlab[] = [
  { from: 0, upTo: 400_000, ratePct: 0 },
  { from: 400_000, upTo: 800_000, ratePct: 5 },
  { from: 800_000, upTo: 1_200_000, ratePct: 10 },
  { from: 1_200_000, upTo: 1_600_000, ratePct: 15 },
  { from: 1_600_000, upTo: 2_000_000, ratePct: 20 },
  { from: 2_000_000, upTo: 2_400_000, ratePct: 25 },
  { from: 2_400_000, upTo: null, ratePct: 30 },
];

/** The rates, rebates, surcharges and cess of tax year 2026-27, from the approved documents only. */
export const INCOME_TAX_2026_27: Record<TaxRegime, RegimeRules> = {
  new: {
    standardDeduction: 75_000,
    // The default rates are the same at every age.
    slabs: { under_60: NEW_SLABS, "60_to_79": NEW_SLABS, "80_plus": NEW_SLABS },
    rebate: { incomeUpTo: 1_200_000, max: 60_000, reliefAbove: true },
    surcharge: [
      { above: 5_000_000, ratePct: 10 },
      { above: 10_000_000, ratePct: 15 },
      { above: 20_000_000, ratePct: 25 },
    ],
    cessPct: 4,
  },
  old: {
    standardDeduction: 50_000,
    slabs: {
      under_60: [
        { from: 0, upTo: 250_000, ratePct: 0 },
        { from: 250_000, upTo: 500_000, ratePct: 5 },
        { from: 500_000, upTo: 1_000_000, ratePct: 20 },
        { from: 1_000_000, upTo: null, ratePct: 30 },
      ],
      "60_to_79": [
        { from: 0, upTo: 300_000, ratePct: 0 },
        { from: 300_000, upTo: 500_000, ratePct: 5 },
        { from: 500_000, upTo: 1_000_000, ratePct: 20 },
        { from: 1_000_000, upTo: null, ratePct: 30 },
      ],
      "80_plus": [
        { from: 0, upTo: 500_000, ratePct: 0 },
        { from: 500_000, upTo: 1_000_000, ratePct: 20 },
        { from: 1_000_000, upTo: null, ratePct: 30 },
      ],
    },
    rebate: { incomeUpTo: 500_000, max: 12_500, reliefAbove: false },
    surcharge: [
      { above: 5_000_000, ratePct: 10 },
      { above: 10_000_000, ratePct: 15 },
      { above: 20_000_000, ratePct: 25 },
      { above: 50_000_000, ratePct: 37 },
    ],
    cessPct: 4,
  },
};

/** The largest salary or deduction accepted (₹1,000 crore): far above any salary, well inside bigint display. */
export const MAX_TAX_INPUT_RUPEES = 10_000_000_000;

export type SlabLine = { from: number; upTo: number | null; ratePct: number; income: number; tax: number };

export type RegimeTax = {
  regime: TaxRegime;
  standardDeduction: number;
  /** Deductions counted (old regime only; the new regime counts none of them). */
  deductions: number;
  taxableIncome: number;
  /** Only the slabs income reaches. */
  slabs: SlabLine[];
  slabTax: number;
  rebate: number;
  /** The new regime's relief just above ₹12,00,000 set the rebate. */
  rebateRelief: boolean;
  taxAfterRebate: number;
  surchargeRatePct: number;
  surcharge: number;
  /** How much marginal relief took off the surcharge. */
  surchargeRelief: number;
  cess: number;
  total: number;
  /** Every figure above was a whole rupee before it was shown. */
  wholeRupees: boolean;
};

export type SalaryTaxInput = { grossSalary: number; ageBand: TaxAgeBand; oldRegimeDeductions?: number };

export type SalaryTaxEstimate = {
  taxYear: typeof TAX_YEAR_2026_27;
  grossSalary: number;
  ageBand: TaxAgeBand;
  new: RegimeTax;
  old: RegimeTax;
  /** The regime with the lower total, or "same"; `difference` is how much lower. */
  lower: TaxRegime | "same";
  difference: number;
};

const UNIT = 1_000_000n; // millionths of a rupee per rupee

const pct = (amount: bigint, ratePct: number) => (amount * BigInt(ratePct)) / 100n;
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** Rupees, half up, from millionths. */
const toRupees = (micro: bigint) => Number((micro + UNIT / 2n) / UNIT);

type Exact = {
  slabs: { slab: TaxSlab; income: bigint; tax: bigint }[];
  slabTax: bigint;
  rebate: bigint;
  rebateRelief: boolean;
  taxAfterRebate: bigint;
  surchargeRatePct: number;
  surcharge: bigint;
  surchargeRelief: bigint;
};

/** Tax and surcharge (before cess) on a taxable income in whole rupees, in millionths of a rupee. */
function beforeCess(rules: RegimeRules, ageBand: TaxAgeBand, taxable: number): Exact {
  const income = BigInt(taxable) * UNIT;
  const slabs = rules.slabs[ageBand]
    .filter((s) => taxable > s.from)
    .map((slab) => {
      const top = slab.upTo === null ? income : min(income, BigInt(slab.upTo) * UNIT);
      const inside = top - BigInt(slab.from) * UNIT;
      return { slab, income: inside, tax: pct(inside, slab.ratePct) };
    });
  const slabTax = slabs.reduce((sum, s) => sum + s.tax, 0n);

  const limit = BigInt(rules.rebate.incomeUpTo) * UNIT;
  let rebate = 0n;
  let rebateRelief = false;
  if (income <= limit) rebate = min(slabTax, BigInt(rules.rebate.max) * UNIT);
  else if (rules.rebate.reliefAbove && slabTax > income - limit) {
    // Just above the limit, the tax is never more than the income above it.
    rebate = slabTax - (income - limit);
    rebateRelief = true;
  }
  const taxAfterRebate = slabTax - rebate;

  const band = [...rules.surcharge].reverse().find((b) => taxable > b.above);
  if (!band) return { slabs, slabTax, rebate, rebateRelief, taxAfterRebate, surchargeRatePct: 0, surcharge: 0n, surchargeRelief: 0n };
  const full = pct(taxAfterRebate, band.ratePct);
  // Marginal relief: tax plus surcharge never more than at the threshold plus the income above it.
  const atThreshold = beforeCess(rules, ageBand, band.above);
  const cap = atThreshold.taxAfterRebate + atThreshold.surcharge + (income - BigInt(band.above) * UNIT);
  const surcharge = max(0n, min(full, cap - taxAfterRebate));
  return { slabs, slabTax, rebate, rebateRelief, taxAfterRebate, surchargeRatePct: band.ratePct, surcharge, surchargeRelief: full - surcharge };
}

/** One regime's tax on a taxable income, for the documents' worked examples (given as taxable income). */
export function taxOnTaxableIncome(regime: TaxRegime, taxableIncome: number, ageBand: TaxAgeBand): RegimeTax {
  return regimeTax(regime, ageBand, { standardDeduction: 0, deductions: 0, taxableIncome });
}

function regimeTax(regime: TaxRegime, ageBand: TaxAgeBand, base: { standardDeduction: number; deductions: number; taxableIncome: number }): RegimeTax {
  const rules = INCOME_TAX_2026_27[regime];
  const exact = beforeCess(rules, ageBand, base.taxableIncome);
  const cess = pct(exact.taxAfterRebate + exact.surcharge, rules.cessPct);
  const total = exact.taxAfterRebate + exact.surcharge + cess;
  const all = [...exact.slabs.map((s) => s.tax), exact.slabTax, exact.rebate, exact.taxAfterRebate, exact.surcharge, exact.surchargeRelief, cess, total];
  return {
    regime,
    ...base,
    slabs: exact.slabs.map((s) => ({ from: s.slab.from, upTo: s.slab.upTo, ratePct: s.slab.ratePct, income: toRupees(s.income), tax: toRupees(s.tax) })),
    slabTax: toRupees(exact.slabTax),
    rebate: toRupees(exact.rebate),
    rebateRelief: exact.rebateRelief,
    taxAfterRebate: toRupees(exact.taxAfterRebate),
    surchargeRatePct: exact.surchargeRatePct,
    surcharge: toRupees(exact.surcharge),
    surchargeRelief: toRupees(exact.surchargeRelief),
    cess: toRupees(cess),
    total: toRupees(total),
    wholeRupees: all.every((m) => m % UNIT === 0n),
  };
}

const wholeRupees = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_TAX_INPUT_RUPEES;

/** Tax on a salary under both regimes, tax year 2026-27. Throws on a salary or deduction that isn't whole, non-negative rupees. */
export function salaryTaxEstimate({ grossSalary, ageBand, oldRegimeDeductions = 0 }: SalaryTaxInput): SalaryTaxEstimate {
  if (!wholeRupees(grossSalary) || !wholeRupees(oldRegimeDeductions)) throw new RangeError("Salary and deductions must be whole rupees.");
  const base = (regime: TaxRegime, deductions: number) => {
    const standardDeduction = Math.min(grossSalary, INCOME_TAX_2026_27[regime].standardDeduction);
    return { standardDeduction, deductions, taxableIncome: Math.max(0, grossSalary - standardDeduction - deductions) };
  };
  const next = regimeTax("new", ageBand, base("new", 0));
  const old = regimeTax("old", ageBand, base("old", oldRegimeDeductions));
  const lower = next.total === old.total ? "same" : next.total < old.total ? "new" : "old";
  return { taxYear: TAX_YEAR_2026_27, grossSalary, ageBand, new: next, old, lower, difference: Math.abs(next.total - old.total) };
}

/** An age in whole years as a band; null for an age that can't be a person's. */
export function taxAgeBand(age: number): TaxAgeBand | null {
  if (!Number.isInteger(age) || age < 0 || age > 130) return null;
  return age >= 80 ? "80_plus" : age >= 60 ? "60_to_79" : "under_60";
}

/** An amount of rupees as someone wrote it, and whether they gave it per month. */
export type WrittenAmount = { rupees: number; perMonth: boolean; text: string };

const SCALES: [RegExp, number][] = [
  [/^(?:crores?|cr)$/i, 10_000_000],
  [/^(?:lakhs?|lacs?|l|lpa)$/i, 100_000],
  [/^(?:k|thousand)$/i, 1_000],
];

const AMOUNT =
  /(?:₹|\brs\.?|\binr)?\s?(\d+(?:,\d+)*(?:\.\d+)?)\s?(crores?|cr|lakhs?|lacs?|lpa|l|k|thousand)?\b(\s?(?:a|per|\/|every)\s?month\b|\s?monthly\b|\s?p\.?m\.?(?![a-z])|\s?(?:a|per|\/)\s?(?:year|annum)\b|\s?p\.?a\.?(?![a-z])|\s?annually\b|\s?yearly\b)?/gi;

/** "14.15" times a scale, exactly; null when it isn't a whole number of rupees. */
function scaled(number: string, scale: number): number | null {
  const [whole = "", fraction = ""] = number.replace(/,/g, "").split(".");
  const digits = BigInt(whole + fraction) * BigInt(scale);
  const divisor = 10n ** BigInt(fraction.length);
  if (digits % divisor !== 0n) return null;
  const rupees = digits / divisor;
  return rupees > BigInt(MAX_TAX_INPUT_RUPEES) ? null : Number(rupees);
}

/**
 * Every rupee amount written in a text: "1415000", "14,15,000", "₹14.15 lakh", "14 lpa",
 * "1.2 crore", "1.2 lakh a month", "50k". Bare numbers below 100 without a scale word (ages,
 * counts) and years after a month are left out, as are amounts that aren't whole rupees.
 */
export function rupeeAmountsIn(text: string): WrittenAmount[] {
  const out: WrittenAmount[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const [raw, number = "", scaleWord, period] = m;
    const scale = scaleWord ? (SCALES.find(([re]) => re.test(scaleWord))?.[1] ?? 1) : 1;
    // A bare small number is an age or a count, not money.
    if (!scaleWord && !/[₹]|rs|inr/i.test(raw) && Number(number.replace(/,/g, "")) < 100) continue;
    const rupees = scaled(number, scale);
    if (rupees === null) continue;
    const perMonth = period !== undefined && /month|p\.?m/i.test(period);
    out.push({ rupees, perMonth, text: raw.trim() });
  }
  return out;
}

/** One amount as someone wrote it ("14.15 lakh", "1.2 lakh a month"); null unless the text is exactly one amount. */
export function parseRupeeAmount(text: string): WrittenAmount | null {
  const found = rupeeAmountsIn(text.trim());
  return found.length === 1 && found[0]!.text.length === text.trim().length ? found[0]! : null;
}
