import { describe, expect, it } from "vitest";
import { budgetFormSchema, goalFormSchema, goalSavedSchema, parseGoalDetails, parsePercentToBps } from "./goal-forms";

const KEY = "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const ID = "0b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e";
const today = "2026-10-26";
const schema = goalFormSchema({ currency: "INR", today });

const errors = (result: ReturnType<typeof schema.safeParse>) =>
  result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));

describe("parsePercentToBps", () => {
  it("reads percentages with up to two decimals", () => {
    expect(parsePercentToBps("8.5")).toBe(850);
    expect(parsePercentToBps("8.75 %")).toBe(875);
    expect(parsePercentToBps("0")).toBe(0);
    expect(parsePercentToBps("100")).toBe(10_000);
    expect(parsePercentToBps("100.01")).toBeNull();
    expect(parsePercentToBps("8.555")).toBeNull();
    expect(parsePercentToBps("-1")).toBeNull();
    expect(parsePercentToBps("")).toBeNull();
  });
});

describe("goalFormSchema", () => {
  it("trip: the target is the sum of the cost lines", () => {
    const result = schema.parse({
      type: "trip",
      name: "Japan in spring",
      targetDate: "2027-03-20",
      saved: "20,000",
      idempotencyKey: KEY,
      scope: "international",
      place: "Japan",
      people: "2",
      days: "8",
      travelMode: "flight",
      stay: "hotel",
      cost_transport: "90,000",
      cost_stay: "64000",
      cost_food: "24000",
      cost_visaInsurance: "8000.50",
    });
    expect(result).toMatchObject({ type: "trip", savedMinor: 20_000_00, targetMinor: 186_000_50, targetDate: "2027-03-20", goalId: null });
    expect(result.details).toMatchObject({ v: 1, people: 2, costs: { transport: 90_000_00, activities: 0, visaInsurance: 8_000_50 } });
  });

  it("trip needs at least one cost and the trip answers", () => {
    const e = errors(schema.safeParse({ type: "trip", name: "Trip", idempotencyKey: KEY }));
    expect(e).toMatchObject({ cost_transport: "Enter at least one cost", scope: "Choose domestic or international", people: expect.any(String) });
  });

  it("car with a down payment: target is the down payment and extras", () => {
    const result = schema.parse({
      type: "vehicle",
      name: "New car",
      idempotencyKey: KEY,
      vehicle: "car",
      condition: "new",
      make: "Maruti Suzuki",
      model: "Swift",
      payment: "loan_down_payment",
      price: "8,00,000",
      extras: "60,000",
      downPayment: "2,00,000",
      rate: "9.5",
      months: "60",
    });
    expect(result.targetMinor).toBe(2_60_000_00);
    expect(result.targetDate).toBeNull();
    expect(result.details).toEqual({
      v: 1,
      vehicle: "car",
      condition: "new",
      make: "Maruti Suzuki",
      model: "Swift",
      extrasMinor: 60_000_00,
      payment: "loan_down_payment",
      priceMinor: 8_00_000_00,
      downPaymentMinor: 2_00_000_00,
      loanRateBps: 950,
      loanMonths: 60,
    });
  });

  it("vehicle: makes and models that aren't listed are accepted; bike, car or HMV is required", () => {
    const base = { type: "vehicle", name: "Truck", idempotencyKey: KEY, condition: "used", make: "Some new maker", model: "Model Z", payment: "cash", price: "25,00,000" }
    expect(schema.parse({ ...base, vehicle: "hmv" }).details).toMatchObject({ vehicle: "hmv", make: "Some new maker", model: "Model Z" })
    expect(errors(schema.safeParse(base)).vehicle).toBe("Choose bike, car or HMV")
    expect(errors(schema.safeParse({ ...base, vehicle: "boat" })).vehicle).toBe("Choose bike, car or HMV")
  });

  it("trip places come from the lists: a state for domestic, a country other than India for international", () => {
    const trip = { type: "trip", name: "Trip", idempotencyKey: KEY, people: "2", days: "3", travelMode: "train", stay: "hotel", cost_transport: "100" }
    expect(schema.safeParse({ ...trip, scope: "domestic", place: "Assam" }).success).toBe(true)
    expect(errors(schema.safeParse({ ...trip, scope: "domestic", place: "Japan" })).place).toBe("Choose a state")
    expect(schema.safeParse({ ...trip, scope: "international", place: "Japan" }).success).toBe(true)
    expect(errors(schema.safeParse({ ...trip, scope: "international", place: "India" })).place).toBe("Choose a country")
  });

  it("a 'car' goal migrated by 20261026200000 reads back as a vehicle, keeping its model", () => {
    // The stored 'car' answers (keys before the rename) …
    const oldCar = {
      v: 1, condition: "new", model: "Audi A6", extrasMinor: 1_50_000_00, payment: "loan_down_payment",
      priceMinor: 65_00_000_00, downPaymentMinor: 15_00_000_00, loanRateBps: 850, loanMonths: 60,
    }
    // … merged exactly as the migration does: details || '{"vehicle": "car", "make": null}'.
    const migrated = { ...oldCar, vehicle: "car", make: null }
    expect(parseGoalDetails("vehicle", migrated)).toEqual({ type: "vehicle", details: migrated })
    expect(parseGoalDetails("vehicle", migrated)?.details).toMatchObject({ model: "Audi A6", make: null })
    expect(parseGoalDetails("car", migrated)).toBeNull()
  });

  it("rejects a down payment at or above the price", () => {
    const e = errors(
      schema.safeParse({ type: "house", name: "Flat", idempotencyKey: KEY, purpose: "buy", city: "Pune", payment: "loan_down_payment", price: "50,00,000", downPayment: "50,00,000", rate: "8.5", months: "240" }),
    );
    expect(e.downPayment).toBe("The down payment must be less than the price");
  });

  it("no-cost EMI asks only for the number of EMIs; nothing to save upfront", () => {
    const result = schema.parse({ type: "mobile", name: "Phone", idempotencyKey: KEY, item: "Phone", price: "60000", payment: "no_cost_emi", months: "6" });
    expect(result.targetMinor).toBe(0);
    expect(result.details).toMatchObject({ payment: "no_cost_emi", emiRateBps: null, emiMonths: 6 });
  });

  it("other: amount entered directly", () => {
    const result = schema.parse({ type: "other", name: "Gift", idempotencyKey: KEY, description: "Wedding gift", amount: "25,000", targetDate: "2026-12-01" });
    expect(result).toMatchObject({ targetMinor: 25_000_00, details: { v: 1, description: "Wedding gift" } });
  });

  it("refuses a past target date unless the goal already has it", () => {
    const input = { type: "other", name: "Gift", idempotencyKey: KEY, description: "Gift", amount: "100", targetDate: "2026-10-01" };
    expect(errors(schema.safeParse(input)).targetDate).toBe("The target date can't be in the past");
    const edit = goalFormSchema({ currency: "INR", today, currentTargetDate: "2026-10-01" });
    expect(edit.safeParse({ ...input, goalId: ID, idempotencyKey: "" }).success).toBe(true);
  });

  it("needs a request key when adding", () => {
    expect(errors(schema.safeParse({ type: "other", name: "Gift", description: "Gift", amount: "100" })).idempotencyKey).toBeDefined();
  });
});

describe("parseGoalDetails", () => {
  it("accepts stored details and rejects anything off-shape", () => {
    const item = { v: 1, item: "Sofa", payment: "cash", priceMinor: 100, emiRateBps: null, emiMonths: null };
    expect(parseGoalDetails("furniture", item)).toEqual({ type: "furniture", details: item });
    expect(parseGoalDetails("furniture", { ...item, extra: 1 })).toBeNull(); // unknown key
    expect(parseGoalDetails("furniture", { ...item, payment: "emi" })).toBeNull(); // EMI without rate and months
    expect(parseGoalDetails("furniture", { ...item, v: 2 })).toBeNull();
    expect(parseGoalDetails("boat", item)).toBeNull();
    expect(parseGoalDetails("other", [1, 2])).toBeNull();
    expect(parseGoalDetails("other", { v: 1, description: "x".repeat(281) })).toBeNull();
  });
});

describe("goalSavedSchema", () => {
  it("allows zero, refuses negatives", () => {
    const s = goalSavedSchema({ currency: "INR" });
    expect(s.parse({ goalId: ID, saved: "0" })).toEqual({ goalId: ID, savedMinor: 0 });
    expect(s.safeParse({ goalId: ID, saved: "-5" }).success).toBe(false);
  });
});

describe("budgetFormSchema", () => {
  const s = budgetFormSchema({ currency: "INR", today });
  it("starts this month or later; blank or 0 removes the budget", () => {
    expect(s.parse({ categoryId: ID, month: "2026-10", amount: "12,000" })).toEqual({ categoryId: ID, effectiveFrom: "2026-10-01", amountMinor: 12_000_00 });
    expect(s.parse({ categoryId: ID, month: "2027-01", amount: "" }).amountMinor).toBe(0);
    expect(s.safeParse({ categoryId: ID, month: "2026-09", amount: "100" }).success).toBe(false);
    expect(s.safeParse({ categoryId: ID, month: "2026-13", amount: "100" }).success).toBe(false);
  });
});
