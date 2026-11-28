import {
  type Database,
  type HomeData,
  type UserClient,
  loadHomeData,
  newRequestKey,
  saveAccount,
  saveGoal,
  saveRecurringRule,
  saveSpendLimit,
  saveTransaction,
  setCategoryBudget,
  userToday,
  voidTransaction,
} from "@fin-creador/api";
import { addDays, daysInMonth, floorToWholeMinor, monthRange, previousMonthRange } from "@fin-creador/domain";
import { createClient } from "@supabase/supabase-js";

// Demo figures for the Home E2E, written as the demo user through the shared writers (public
// API, RLS applies; no service key), on CI's throwaway local Supabase only (demo-user.ts checks
// the URL before any user exists). Dates are relative to the user's today, so the figures are
// the same on every run: 8 days to the next income, the bills inside them (or overdue).

export type Demo = { client: UserClient; today: string };

export async function demoClient(email: string, password: string): Promise<Demo> {
  const client = createClient<Database>(process.env.EXPO_PUBLIC_SUPABASE_URL ?? "", process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Demo sign-in failed: ${error.message}`);
  const day = await userToday(client);
  if (!day.ok) throw new Error(`Could not read today: ${day.reason}`);
  return { client, today: day.today };
}

function ok(result: { status: string; message: string }, what: string) {
  if (result.status !== "success") throw new Error(`${what}: ${result.message}`);
}

async function ids(client: UserClient) {
  const [{ data: categories }, { data: accounts }] = await Promise.all([
    client.from("categories").select("id, kind, icon, source_type"),
    client.from("accounts").select("id, kind, name"),
  ]);
  const expense = (icon: string) => categories?.find((c) => c.kind === "expense" && c.icon === icon)?.id ?? ""
  return {
    food: expense("food"),
    bills: expense("bills"),
    home: expense("home"),
    salary: categories?.find((c) => c.kind === "income" && c.source_type === "salary")?.id ?? "",
    account: (name: string) => accounts?.find((a) => a.name === name)?.id ?? "",
  };
}

async function addBank(demo: Demo, balance: string) {
  ok(
    await saveAccount(demo.client, {
      kind: "bank", bankType: "savings", bankName: "HDFC Bank", currency: "INR", openingBalance: balance, openingBalanceDate: demo.today,
    }),
    "Add HDFC Bank",
  );
}

/** inDays may be negative: a rule that started in the past and was never posted is overdue. */
async function addRule(demo: Demo, rule: { type: "income" | "expense"; amount: string; categoryId: string; accountId: string; inDays: number; note: string }) {
  ok(
    await saveRecurringRule(demo.client, {
      type: rule.type, amount: rule.amount, categoryId: rule.categoryId, accountId: rule.accountId, counterAccountId: "", paymentMode: "",
      frequency: "monthly", startDate: addDays(demo.today, rule.inDays), endDate: "", note: rule.note, idempotencyKey: newRequestKey(),
    }),
    `Add recurring ${rule.note}`,
  );
}

/**
 * Normal month: HDFC Bank ₹38,500 and Cash ₹3,500 (₹42,000), salary in 8 days, electricity
 * ₹2,400 in 2 days and phone ₹600 in 5 days, an Emergency fund of ₹60,000 with no target
 * date (spread over 12 months: ₹5,000 a month, all still due), ₹1,200 spent on food today
 * (budget ₹6,000). Final rule (goals shown, not subtracted): (₹42,000 − ₹3,000) ÷ 8 = ₹4,875
 * a day; ₹3,675 left today. Without income: the same, shared over the days to the month's end
 * (see noIncomeDailyMinor).
 */
export async function seedNormal(demo: Demo, { income = true }: { income?: boolean } = {}) {
  await addBank(demo, "38500");
  ok(await saveAccount(demo.client, { kind: "cash", name: "Cash", currency: "INR", openingBalance: "3500", openingBalanceDate: demo.today }), "Add cash");
  const id = await ids(demo.client);
  const hdfc = id.account("HDFC Bank");
  if (income) await addRule(demo, { type: "income", amount: "85000", categoryId: id.salary, accountId: hdfc, inDays: 8, note: "Salary" });
  await addRule(demo, { type: "expense", amount: "2400", categoryId: id.bills, accountId: hdfc, inDays: 2, note: "Electricity" });
  await addRule(demo, { type: "expense", amount: "600", categoryId: id.bills, accountId: hdfc, inDays: 5, note: "Phone" });
  ok(
    await saveTransaction(demo.client, {
      type: "expense", amount: "1200", categoryId: id.food, accountId: hdfc, counterAccountId: "", paymentMode: "", refundOfId: "",
      occurredOn: demo.today, note: "Groceries", idempotencyKey: newRequestKey(),
    }),
    "Add today's expense",
  );
  ok(await setCategoryBudget(demo.client, { categoryId: id.food, month: demo.today.slice(0, 7), amount: "6000" }), "Set food budget");
  ok(
    await saveGoal(demo.client, {
      type: "other", name: "Emergency fund", description: "Six months of expenses", amount: "60000", targetDate: "", saved: "",
      idempotencyKey: newRequestKey(),
    }),
    "Add goal",
  );
}

/**
 * The normal month without income, as shown (whole rupees): (₹42,000 − the bills due by month
 * end) ÷ the days left in the month, today included. Near month end the phone (in 5 days) or
 * electricity (in 2 days) falls in next month.
 */
export function noIncomeDailyMinor(today: string): number {
  const inMonth = (days: number) => addDays(today, days).slice(0, 7) === today.slice(0, 7);
  const afterBills = 42_000_00 - (inMonth(2) ? 2_400_00 : 0) - (inMonth(5) ? 600_00 : 0);
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  const days = daysInMonth(year, month) - day + 1;
  return floorToWholeMinor(Math.floor(afterBills / days), "INR");
}

/**
 * Overdue: the normal month plus internet ₹1,000 from HDFC Bank, due 3 days ago and never
 * paid. → (₹42,000 − ₹4,000) ÷ 8 = ₹4,750 a day; ₹3,550 left today.
 */
export async function seedOverdue(demo: Demo) {
  await seedNormal(demo);
  const id = await ids(demo.client);
  await addRule(demo, { type: "expense", amount: "1000", categoryId: id.bills, accountId: id.account("HDFC Bank"), inDays: -3, note: "Internet" });
}

/** Due today: the normal month plus internet ₹1,000 from HDFC Bank, due today (Recurring → Confirm). */
export async function seedDueToday(demo: Demo) {
  await seedNormal(demo);
  const id = await ids(demo.client);
  await addRule(demo, { type: "expense", amount: "1000", categoryId: id.bills, accountId: id.account("HDFC Bank"), inDays: 0, note: "Internet" });
}

/**
 * Paise: the normal month plus an Education EMI of ₹11,423.40 from HDFC Bank in 3 days. Coming
 * up shows it as ₹11,424 (an amount to pay rounds up) and Bills due is the rows as shown:
 * ₹2,400 + ₹600 + ₹11,424 = ₹14,424 (exact total ₹14,423.40).
 * → (₹42,000 − ₹14,423.40) ÷ 8 = ₹3,447.07 → ₹3,447 a day; ₹2,247 left today.
 */
export async function seedPaise(demo: Demo) {
  await seedNormal(demo);
  const id = await ids(demo.client);
  await addRule(demo, { type: "expense", amount: "11423.40", categoryId: id.bills, accountId: id.account("HDFC Bank"), inDays: 3, note: "Education EMI" });
}

/** Short: HDFC Bank ₹9,000, salary in 8 days, rent ₹12,000 from HDFC Bank in 5 days → ₹3,000 short. */
export async function seedShort(demo: Demo) {
  await addBank(demo, "9000");
  const id = await ids(demo.client);
  const hdfc = id.account("HDFC Bank");
  await addRule(demo, { type: "income", amount: "85000", categoryId: id.salary, accountId: hdfc, inDays: 8, note: "Salary" });
  await addRule(demo, { type: "expense", amount: "12000", categoryId: id.home, accountId: hdfc, inDays: 5, note: "Rent" });
}

/**
 * Daily spend limit: the normal month plus ₹14,000 a week, set today (so the week starts
 * today). → ₹14,000 ÷ 7 = ₹2,000 daily limit; ₹1,200 spent today → ₹800 left. ₹2,000 × 8 days
 * is within the ₹39,000 left after bills, so no safety note.
 */
export async function seedLimit(demo: Demo) {
  await seedNormal(demo);
  ok(await saveSpendLimit(demo.client, { period: "week", amount: "14000" }), "Set spend limit");
}

/**
 * Activity (13b PR 4): HDFC Bank ₹50,000 and Cash ₹0, opened 10 days before last month. Last
 * month (M): salary +₹80,000 on the 1st; rent ₹20,000 on the 2nd; a ₹5,000 transfer HDFC Bank
 * → Cash and groceries ₹1,500 edited to ₹1,600 ("Edited") on the 3rd; dinner ₹900 voided on the
 * 4th; 50 teas of ₹20 on the 5th (so the month has 54 entries shown: Load more after 50). →
 * Money in ₹80,000, money out ₹22,600, net +₹57,400, 72% saved; no trend (no income the month
 * before). This month: nothing. Returns last month's first day.
 */
export async function seedActivity(demo: Demo): Promise<{ month: string }> {
  const month = previousMonthRange(monthRange(demo.today).start).start;
  const day = (n: number) => addDays(month, n - 1);
  const opened = addDays(month, -10);
  ok(await saveAccount(demo.client, { kind: "bank", bankType: "savings", bankName: "HDFC Bank", currency: "INR", openingBalance: "50000", openingBalanceDate: opened }), "Add HDFC Bank");
  ok(await saveAccount(demo.client, { kind: "cash", name: "Cash", currency: "INR", openingBalance: "0", openingBalanceDate: opened }), "Add cash");
  const id = await ids(demo.client);
  const hdfc = id.account("HDFC Bank");
  const cash = id.account("Cash");
  const entry = (type: "income" | "expense" | "transfer", amount: string, on: string, note: string, extra: Partial<{ categoryId: string; counterAccountId: string; transactionId: string }> = {}) =>
    saveTransaction(demo.client, {
      type, amount, categoryId: extra.categoryId ?? "", accountId: hdfc, counterAccountId: extra.counterAccountId ?? "", paymentMode: "", refundOfId: "",
      occurredOn: on, note, idempotencyKey: newRequestKey(), ...(extra.transactionId ? { transactionId: extra.transactionId } : {}),
    });
  ok(await entry("income", "80000", day(1), "Salary", { categoryId: id.salary }), "Salary");
  ok(await entry("expense", "20000", day(2), "Rent", { categoryId: id.home }), "Rent");
  ok(await entry("transfer", "5000", day(3), "", { counterAccountId: cash }), "Transfer");
  ok(await entry("expense", "1500", day(3), "Groceries", { categoryId: id.food }), "Groceries");
  const { data: groceries } = await demo.client.from("transactions").select("id").eq("note", "Groceries").single();
  ok(await entry("expense", "1600", day(3), "Groceries", { categoryId: id.food, transactionId: groceries?.id ?? "" }), "Edit groceries");
  ok(await entry("expense", "900", day(4), "Dinner", { categoryId: id.food }), "Dinner");
  const { data: dinner } = await demo.client.from("transactions").select("id").eq("note", "Dinner").single();
  ok(await voidTransaction(demo.client, { transactionId: dinner?.id ?? "", idempotencyKey: newRequestKey(), reason: "Entered twice" }), "Void dinner");
  for (let i = 0; i < 50; i++) ok(await entry("expense", "20", day(5), "Tea", { categoryId: id.food }), `Tea ${i + 1}`);
  return { month };
}

/** What Home should show for this user: the shared loader's result, read as them. */
export async function expectedHome(demo: Demo): Promise<HomeData> {
  const home = await loadHomeData(demo.client);
  if (!home.ok) throw new Error(`Home loader failed: ${home.reason}`);
  return home.data;
}
