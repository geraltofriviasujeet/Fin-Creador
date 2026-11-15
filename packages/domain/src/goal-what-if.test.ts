import { describe, expect, it } from "vitest";
import { type GoalProjectionInput, goalProjection } from "./goal-projection";
import { goalWhatIf, whatIfAmountsIn, whatIfMonthsIn } from "./goal-what-if";

const month = (net: number) => ({ incomeMinor: net > 0 ? net : 0, expenseMinor: net < 0 ? -net : 0 });
const six = (net: number) => Array.from({ length: 6 }, () => month(net));

const base: GoalProjectionInput = {
  today: "2026-11-06",
  targetMinor: 120_000,
  savedMinor: 0,
  targetDate: "2027-10-31",
  months: six(10_000),
  claims: [],
  otherGoals: [],
};

/** The goal check's own fixtures (goal-projection.test.ts), every basis and verdict. */
const fixtures: Record<string, GoalProjectionInput> = {
  "on time": base,
  late: { ...base, months: six(9_000) },
  "rounded extra": { ...base, targetMinor: 120_001 },
  "one unusual month": { ...base, months: [month(10_000), month(10_000), month(10_000), month(900_000), month(-500_000), month(10_000)] },
  thin: { ...base, months: [month(10_000), month(10_000), month(10_000), month(10_000), month(0), month(0)] },
  "too early": { ...base, months: [month(50_000), month(50_000), month(0)] },
  "other goals": { ...base, otherGoals: [{ monthlyMinor: 5_000, months: 3 }] },
  claims: {
    ...base,
    claims: [
      { date: "2026-09-10", amountMinor: 3_000 },
      { date: "2026-11-30", amountMinor: 2_000 },
      { date: "2027-02-05", amountMinor: 7_000 },
      { date: "2040-01-01", amountMinor: 999_999 },
    ],
  },
  "a month below zero": { ...base, targetDate: "2026-12-31", targetMinor: 15_000, claims: [{ date: "2026-12-01", amountMinor: 20_000 }] },
  "nothing free": { ...base, months: six(-1_000) },
  "no date": { ...base, targetDate: null, targetMinor: 50_000 },
  "no date, out of reach": { ...base, targetDate: null, targetMinor: 1_300_000 },
  "beyond 10 years": { ...base, targetDate: "2041-10-31", targetMinor: 1_500_000 },
  "date passed": { ...base, targetDate: "2026-08-31", targetMinor: 30_000, savedMinor: 5_000 },
  "date passed, too early": { ...base, targetDate: "2026-08-31", months: [] },
  reached: { ...base, savedMinor: 120_000, months: [] },
};

describe("goalWhatIf: consistency with goalProjection", () => {
  for (const [name, input] of Object.entries(fixtures)) {
    it(`a change of zero gives exactly the goal check (${name})`, () => {
      const projection = goalProjection(input);
      for (const change of [{ kind: "monthly", deltaMinor: 0 }, { kind: "cost", deltaMinor: 0 }] as const) {
        const r = goalWhatIf(input, change);
        expect(r.before).toStrictEqual(projection);
        expect(r.after).toStrictEqual(projection);
      }
    });
  }

  const roundTrips: [string, GoalProjectionInput, string][] = [
    ["late", fixtures.late!, "2027-10-01"],
    ["late, sooner", fixtures.late!, "2027-03-01"],
    ["other goals", fixtures["other goals"]!, "2027-10-01"],
    ["claims", fixtures.claims!, "2027-06-01"],
    ["a month below zero", fixtures["a month below zero"]!, "2026-12-01"],
    ["nothing free", fixtures["nothing free"]!, "2028-05-01"],
    ["no date, out of reach", fixtures["no date, out of reach"]!, "2030-01-01"],
    ["date passed", fixtures["date passed"]!, "2026-11-01"],
    ["this month only", { ...base, targetMinor: 1_234_567 }, "2026-11-01"],
  ];
  for (const [name, input, by] of roundTrips) {
    it(`the amount a month by a month, fed back in, reaches it by then; one rupee less doesn't (${name})`, () => {
      const r = goalWhatIf(input, { kind: "by_month", month: by });
      expect(r.outcome).toBe("projected");
      const { extraMonthlyMinor: extra, neededMonthlyMinor: needed, months } = r.byMonth!;
      expect(extra).toBeGreaterThan(0);
      const enough = goalWhatIf(input, { kind: "monthly", deltaMinor: extra }).after!;
      expect(enough.reachMonth).not.toBeNull();
      expect(enough.reachMonth! <= by).toBe(true);
      expect(enough).toStrictEqual(r.after);
      for (const less of [extra - 1, extra - 100].filter((x) => x >= 0)) {
        const short = goalWhatIf(input, { kind: "monthly", deltaMinor: less }).after!;
        expect(short.reachMonth === null || short.reachMonth > by).toBe(true);
      }
      // The flat amount: enough over the months, and a rupee less a month is not.
      const remaining = r.before!.plan.remainingMinor;
      expect(needed * months).toBeGreaterThanOrEqual(remaining);
      expect((needed - 100) * months).toBeLessThan(remaining);
    });
  }
});

describe("goalWhatIf: changes", () => {
  it("saving more a month brings the month forward", () => {
    // 10,000 + 2,000 = 12,000 a month: 120,000 in 10 months, November to August.
    const r = goalWhatIf(base, { kind: "monthly", deltaMinor: 2_000 });
    expect(r).toMatchObject({ outcome: "projected", before: { reachMonth: "2027-10-01" }, after: { reachMonth: "2027-08-01", freeThisMonthMinor: 12_000 } });
  });

  it("saving more than is free is still worked out (the person's own hypothetical)", () => {
    const r = goalWhatIf(base, { kind: "monthly", deltaMinor: 50_000 });
    expect(r).toMatchObject({ outcome: "projected", before: { freeThisMonthMinor: 10_000 }, after: { reachMonth: "2026-12-01" } });
  });

  it("saving less pushes it back", () => {
    // 6,000 a month: 20 months, November 2026 to June 2028.
    const r = goalWhatIf(base, { kind: "monthly", deltaMinor: -4_000 });
    expect(r).toMatchObject({ outcome: "projected", after: { reachMonth: "2028-06-01", verdict: "no" } });
  });

  it("saving less that leaves nothing a month is never reached, with no date", () => {
    for (const deltaMinor of [-10_000, -15_000]) {
      const r = goalWhatIf(base, { kind: "monthly", deltaMinor });
      expect(r).toMatchObject({ outcome: "not_reached", after: { reachMonth: null, verdict: "no" } });
    }
    // Even when a loan ending would later free money up.
    const loan = { ...base, claims: [{ date: "2026-11-15", amountMinor: 5_000 }] };
    expect(goalWhatIf(loan, { kind: "monthly", deltaMinor: -5_000 })).toMatchObject({ outcome: "not_reached", after: { reachMonth: null } });
  });

  // From dev (10.7a): median net −₹49,819.30, free for the goal −₹2,90,659.13 this month.
  const assam: GoalProjectionInput = {
    ...base,
    targetMinor: 10_000_000,
    targetDate: null,
    months: six(-4_981_930),
    claims: [{ date: "2026-11-20", amountMinor: 24_083_983 }],
  };

  it("nothing free: saving more counts from zero, so the amount is what goes to the goal a month", () => {
    const r = goalWhatIf(assam, { kind: "monthly", deltaMinor: 500_000 });
    expect(r.before).toMatchObject({ freeThisMonthMinor: -29_065_913, reachMonth: null });
    // ₹1,00,000 at ₹5,000 a month: 20 months, November 2026 to June 2028.
    expect(r).toMatchObject({ outcome: "projected", floored: true, after: { freeThisMonthMinor: 500_000, reachMonth: "2028-06-01" } });
    // A change of zero is still exactly the goal check: not reached.
    const zero = goalWhatIf(assam, { kind: "monthly", deltaMinor: 0 });
    expect(zero).toMatchObject({ outcome: "not_reached", floored: false });
    expect(zero.after).toStrictEqual(goalProjection(assam));
    // Less is still not reached.
    expect(goalWhatIf(assam, { kind: "monthly", deltaMinor: -500_000 })).toMatchObject({ outcome: "not_reached", floored: false });
  });

  it("counts this month as month 1: ₹95,000 at ₹5,000 a month from November 2026 is May 2028 (month 19)", () => {
    const r = goalWhatIf({ ...assam, today: "2026-11-15", targetMinor: 9_500_000 }, { kind: "monthly", deltaMinor: 500_000 });
    expect(r).toMatchObject({ floored: true, after: { reachMonth: "2028-05-01" } });
  });

  it("nothing free this month but money freed later: each month counts from zero", () => {
    // A ₹20,000 claim this month only: this month counts as 0, then ₹10,000 a month, plus ₹2,000.
    const r = goalWhatIf({ ...base, claims: [{ date: "2026-11-20", amountMinor: 20_000 }] }, { kind: "monthly", deltaMinor: 2_000 });
    // November 2,000, then 12,000 a month: 2,000 + 12,000 × 10 = 122,000 by September 2027.
    expect(r).toMatchObject({ floored: true, after: { reachMonth: "2027-09-01" } });
  });

  it("nothing free, by a month: the full monthly amount needed", () => {
    const r = goalWhatIf(assam, { kind: "by_month", month: "2027-10-01" });
    // ₹1,00,000 over 12 months: ₹8,333.34 a month, all of it on top of nothing free.
    expect(r).toMatchObject({ outcome: "projected", floored: true });
    expect(r.byMonth).toStrictEqual({ month: "2027-10-01", months: 12, neededMonthlyMinor: 833_334, extraMonthlyMinor: 833_334, availableMinor: 0 });
    expect(r.after!.reachMonth).toBe("2027-10-01");
  });

  it("nothing free and costing more or less: still not reached", () => {
    expect(goalWhatIf(assam, { kind: "cost", deltaMinor: 1_000_000 })).toMatchObject({ outcome: "not_reached", floored: false });
    expect(goalWhatIf(assam, { kind: "cost", deltaMinor: -1_000_000 })).toMatchObject({ outcome: "not_reached" });
  });

  it("nothing free: never reached, said so", () => {
    expect(goalWhatIf(fixtures["nothing free"]!, { kind: "monthly", deltaMinor: 0 })).toMatchObject({ outcome: "not_reached", after: { reachMonth: null } });
  });

  it("costing more or less moves the month", () => {
    // 132,000 at 10,000 a month: 14 months, December 2027.
    expect(goalWhatIf(base, { kind: "cost", deltaMinor: 12_000 })).toMatchObject({ outcome: "projected", after: { reachMonth: "2027-12-01", plan: { remainingMinor: 132_000 } } });
    expect(goalWhatIf(base, { kind: "cost", deltaMinor: -60_000 })).toMatchObject({ outcome: "projected", after: { reachMonth: "2027-04-01" } });
  });

  it("costing less than is saved: reached at that cost", () => {
    expect(goalWhatIf({ ...base, savedMinor: 50_000 }, { kind: "cost", deltaMinor: -80_000 })).toMatchObject({ outcome: "reached", after: { plan: { basis: "reached" } } });
  });

  it("a change that takes the cost to zero or below: nothing left to save, no projection", () => {
    for (const deltaMinor of [-120_000, -200_000]) {
      expect(goalWhatIf(base, { kind: "cost", deltaMinor })).toMatchObject({ outcome: "no_cost_left", after: null, byMonth: null });
    }
  });

  it("costing more brings a reached goal back into the projection", () => {
    expect(goalWhatIf({ ...base, savedMinor: 120_000 }, { kind: "cost", deltaMinor: 30_000 })).toMatchObject({ outcome: "projected", after: { reachMonth: "2027-01-01" } });
  });

  it("the amount a month by a month: the flat amount and the extra over what is free", () => {
    // 108,000 free by October 2027: 12,000 short over 12 months, 1,000 more a month.
    const late = goalWhatIf(fixtures.late!, { kind: "by_month", month: "2027-10-01" });
    expect(late.byMonth).toStrictEqual({ month: "2027-10-01", months: 12, neededMonthlyMinor: 10_000, extraMonthlyMinor: 1_000, availableMinor: 108_000 });
    expect(late.after!.reachMonth).toBe("2027-10-01");
    // Covered by what is free: no extra.
    const covered = goalWhatIf(fixtures.late!, { kind: "by_month", month: "2027-12-01" });
    expect(covered.byMonth).toMatchObject({ months: 14, extraMonthlyMinor: 0, availableMinor: 126_000 });
    expect(covered.after).toStrictEqual(goalProjection(fixtures.late!));
  });

  it("a month before this one is refused", () => {
    expect(goalWhatIf(base, { kind: "by_month", month: "2026-10-01" })).toMatchObject({ outcome: "past_month", after: null, byMonth: null });
  });

  it("already reached: nothing to work out", () => {
    const reached = fixtures.reached!;
    expect(goalWhatIf(reached, { kind: "monthly", deltaMinor: 5_000 }).outcome).toBe("reached");
    expect(goalWhatIf(reached, { kind: "by_month", month: "2027-06-01" })).toMatchObject({ outcome: "reached", byMonth: null });
  });

  it("no target amount: nothing to work out", () => {
    const none = { ...base, targetMinor: 0 };
    for (const change of [{ kind: "monthly", deltaMinor: 5_000 }, { kind: "cost", deltaMinor: 5_000 }, { kind: "by_month", month: "2027-06-01" }] as const) {
      expect(goalWhatIf(none, change)).toStrictEqual({ outcome: "no_target", before: null, after: null, byMonth: null, floored: false });
    }
  });

  it("under 3 months with records: too early, no figure", () => {
    const early = fixtures["too early"]!;
    expect(goalWhatIf(early, { kind: "monthly", deltaMinor: 5_000 })).toMatchObject({ outcome: "too_early", after: { medianNetMinor: null, reachMonth: null } });
    expect(goalWhatIf(early, { kind: "by_month", month: "2027-06-01" })).toMatchObject({ outcome: "too_early", byMonth: null });
    expect(goalWhatIf(early, { kind: "cost", deltaMinor: 5_000 })).toMatchObject({ outcome: "too_early", after: { reachMonth: null } });
  });

  it("3 to 5 months with records: worked out and marked thin, as the goal check does", () => {
    const r = goalWhatIf(fixtures.thin!, { kind: "monthly", deltaMinor: 2_000 });
    expect(r).toMatchObject({ outcome: "projected", before: { thin: true, monthsMeasured: 4 }, after: { thin: true, reachMonth: "2027-08-01" } });
  });

  it("refuses amounts that aren't whole minor units", () => {
    expect(() => goalWhatIf(base, { kind: "monthly", deltaMinor: 0.5 })).toThrow(RangeError);
  });
});

describe("whatIfAmountsIn", () => {
  it.each([
    ["if I save 5000 more", [5_000]],
    ["save ₹5,000 more a month", [5_000]],
    ["5k more a month", [5_000]],
    ["agar 5 hazaar zyada bachau to kab tak", [5_000]],
    ["what if it costs 2 lakh more", [200_000]],
    ["if it costs 1.5 lakh less", [150_000]],
  ])("%s", (text, amounts) => {
    expect(whatIfAmountsIn(text)).toStrictEqual(amounts);
  });

  it("leaves out the year or count of a month written with it", () => {
    expect(whatIfAmountsIn("how much a month to reach Car by Dec 2027")).toStrictEqual([]);
    expect(whatIfAmountsIn("in 18 months")).toStrictEqual([]);
    expect(whatIfAmountsIn("2 saal mein")).toStrictEqual([]);
  });

  it("finds nothing in words it can't read", () => {
    expect(whatIfAmountsIn("if I save a bit more")).toStrictEqual([]);
    expect(whatIfAmountsIn("paanch hazaar zyada")).toStrictEqual([]);
  });
});

describe("whatIfMonthsIn", () => {
  const today = "2026-11-15";
  it.each([
    ["by Dec 2027", ["2027-12-01"]],
    ["by December 2027", ["2027-12-01"]],
    ["by Sept 2028?", ["2028-09-01"]],
    ["by next June", ["2027-06-01"]],
    ["by next December", ["2026-12-01"]],
    ["by next November", ["2027-11-01"]],
    ["in 18 months", ["2028-05-01"]],
    ["18 mahine mein", ["2028-05-01"]],
    ["2 saal mein", ["2028-11-01"]],
    ["in 2 years", ["2028-11-01"]],
  ])("%s", (text, months) => {
    expect(whatIfMonthsIn(text, today)).toStrictEqual(months);
  });

  it("finds nothing in words it can't read", () => {
    for (const text of ["by June", "soon", "for 18 months", "by the end of next year", "do saal mein"]) {
      expect(whatIfMonthsIn(text, today)).toStrictEqual([]);
    }
  });
});
