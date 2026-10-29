import { expenseCategoryFormSchema, firstFieldErrors, type ExpenseIcon } from "@fin-creador/schemas"
import type { UserClient } from "../income/client"
import type { WriteResult } from "../income/types"
import type { FormInput } from "../income/writers"

// Expense categories: add, rename (and change the icon), archive and restore, shared by
// web and mobile. Defaults can be archived like any other category, except system categories
// (system_key: the ones the app posts to itself, FC042); nothing is deleted
// (clients have no delete grant), so archived categories keep their entries' history.
// One active category per name, ignoring case and spaces (categories_user_kind_name_active_idx).

export type ExpenseCategoryItem = {
  id: string
  name: string
  icon: ExpenseIcon
  isDefault: boolean
  /** A system category (loan interest, Bank charges & interest...): can be renamed, never archived. */
  system: boolean
  archived: boolean
}

const FIX_FIELDS = "Please fix the highlighted fields."
const DUPLICATE = "You already have a category with this name."
const UNAVAILABLE = "We couldn't save that category. Please try again."

/** The caller's expense categories by name (RLS applies); creates the defaults on first use. */
export async function loadExpenseCategories(
  supabase: UserClient,
): Promise<{ ok: true; categories: ExpenseCategoryItem[] } | { ok: false }> {
  const load = () =>
    supabase.from("categories").select("id, name, icon, is_default, system_key, archived_at").eq("kind", "expense").order("name")
  let res = await load()
  if (!res.error && res.data.length === 0) {
    // Lazy fallback: sign-up seeding never blocks sign-up, so it may not have run.
    await supabase.rpc("ensure_my_expense_categories")
    res = await load()
  }
  if (res.error) return { ok: false }
  return {
    ok: true,
    categories: res.data.map((c) => ({
      id: c.id,
      name: c.name,
      icon: (c.icon ?? "other") as ExpenseIcon,
      isDefault: c.is_default,
      system: c.system_key !== null,
      archived: c.archived_at !== null,
    })),
  }
}

/** Add (no `id`) or rename and re-icon (with `id`) an expense category. */
export async function saveExpenseCategory(supabase: UserClient, input: FormInput): Promise<WriteResult> {
  const parsed = expenseCategoryFormSchema.safeParse(input)
  if (!parsed.success) return { status: "error", message: FIX_FIELDS, fieldErrors: firstFieldErrors(parsed.error) }
  const { id, name, icon } = parsed.data

  const { data, error } = id
    ? await supabase.from("categories").update({ name, icon }).eq("id", id).eq("kind", "expense").select("id").maybeSingle()
    : await supabase.from("categories").insert({ kind: "expense", name, icon }).select("id").maybeSingle()
  if (error?.code === "23505") return { status: "error", message: FIX_FIELDS, fieldErrors: { name: DUPLICATE } }
  if (error || !data) return { status: "error", message: UNAVAILABLE }
  return { status: "success", message: id ? "Category saved." : "Category added." }
}

/** Archive (hidden from new entries; history stays) or restore an expense category. */
export async function setExpenseCategoryArchived(
  supabase: UserClient,
  input: { id: string; archived: boolean },
): Promise<WriteResult> {
  const { data, error } = await supabase
    .from("categories")
    .update({ archived_at: input.archived ? new Date().toISOString() : null })
    .eq("id", input.id)
    .eq("kind", "expense")
    .select("id")
    .maybeSingle()
  if (error?.code === "23505") {
    return { status: "error", message: "An active category already has this name. Rename one of them first." }
  }
  if (error || !data) return { status: "error", message: "We couldn't update that category. Please try again." }
  return { status: "success", message: input.archived ? "Category archived." : "Category restored." }
}
