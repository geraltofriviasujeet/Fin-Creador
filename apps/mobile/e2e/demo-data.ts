import {
  type Database,
  type HomeData,
  type UserClient,
  loadHomeData,
  newRequestKey,
  saveAccount,
  saveGoal,
  saveRecurringRule,
  saveTransaction,
  setCategoryBudget,
  userToday,
} from "@fin-creador/api";
import { addDays } from "@fin-creador/domain";
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
 * (budget ₹6,000). → (₹42,000 − ₹3,000 − ₹5,000) ÷ 8 = ₹4,250 a day; ₹3,050 left today.
 * Without income: ₹34,000 money left this month.
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
 * Overdue: the normal month plus internet ₹1,000 from HDFC Bank, due 3 days ago and never
 * paid. → (₹42,000 − ₹4,000 − ₹5,000) ÷ 8 = ₹4,125 a day; ₹2,925 left today.
 */
export async function seedOverdue(demo: Demo) {
  await seedNormal(demo);
  const id = await ids(demo.client);
  await addRule(demo, { type: "expense", amount: "1000", categoryId: id.bills, accountId: id.account("HDFC Bank"), inDays: -3, note: "Internet" });
}

/**
 * Paise: the normal month plus an Education EMI of ₹11,423.40 from HDFC Bank in 3 days. Coming
 * up shows it as ₹11,424 (an amount to pay rounds up) and Bills due is the rows as shown:
 * ₹2,400 + ₹600 + ₹11,424 = ₹14,424 (exact total ₹14,423.40).
 * → (₹42,000 − ₹14,423.40 − ₹5,000) ÷ 8 = ₹2,822.07 → ₹2,822 a day; ₹1,622 left today.
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

/** What Home should show for this user: the shared loader's result, read as them. */
export async function expectedHome(demo: Demo): Promise<HomeData> {
  const home = await loadHomeData(demo.client);
  if (!home.ok) throw new Error(`Home loader failed: ${home.reason}`);
  return home.data;
}
