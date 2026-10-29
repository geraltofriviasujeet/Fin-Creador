import { type Page, expect, test } from "@playwright/test"
import { addBank, dialog, signUpConfirmed, toast, uniqueEmail } from "./helpers"

// Settings → Categories end to end, against the throwaway local Supabase.

const section = (page: Page) => page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "Categories" }) })
const active = (page: Page) => page.getByRole("list", { name: "Active categories" })
const archived = (page: Page) => page.getByRole("list", { name: "Archived categories" })

async function addCategory(page: Page, name: string, icon?: string) {
  await section(page).getByRole("button", { name: "Add category" }).click()
  const d = dialog(page, "Add category")
  await d.getByLabel("Name").fill(name)
  if (icon) await d.getByLabel("Icon").selectOption({ label: icon })
  await d.getByRole("button", { name: "Add category" }).click()
  return d
}

test("expense categories: add, rename, archive and restore, without duplicates or lost history", async ({ page }) => {
  await signUpConfirmed(page, "Cat Egory", uniqueEmail("categories"))

  // An expense in a default category, to show that archiving keeps history.
  await page.goto("/income")
  await addBank(page, { bank: "HDFC Bank", last4: "4821", opening: "5,000" })
  await page.goto("/transactions?add=expense")
  const add = dialog(page, "Add expense")
  await add.getByLabel("Amount").fill("300")
  await add.getByLabel("Category").selectOption({ label: "Groceries" })
  await add.getByLabel("Paid from").selectOption({ label: "HDFC Bank ··4821" })
  await add.getByLabel("Note").fill("Vegetables")
  await add.getByRole("button", { name: "Save expense" }).click()
  await expect(toast(page, "Expense saved.")).toBeVisible()

  await page.goto("/settings")
  await expect(active(page).getByRole("listitem")).toHaveCount(15)
  await expect(active(page).getByRole("listitem").filter({ hasText: "Groceries" })).toContainText("Default")

  // Add, then a duplicate name (any case, spaces) is refused and the typed name is kept.
  let d = await addCategory(page, "Pets", "Health")
  await expect(toast(page, "Category added.")).toBeVisible()
  await expect(d).toBeHidden()
  d = await addCategory(page, "  groceries ")
  await expect(d.locator("#name-error")).toHaveText("You already have a category with this name.")
  await expect(d.getByLabel("Name")).toHaveValue("  groceries ")
  await page.keyboard.press("Escape")

  // Rename.
  await active(page).getByRole("button", { name: "Rename Pets" }).click()
  const rename = dialog(page, "Rename Pets")
  await rename.getByLabel("Name").fill("Pets & vet")
  await rename.getByRole("button", { name: "Save" }).click()
  await expect(toast(page, "Category saved.")).toBeVisible()
  await expect(active(page).getByText("Pets & vet")).toBeVisible()

  // Archive a default: gone from new entries, kept on the old one.
  await active(page).getByRole("button", { name: "Archive Groceries" }).click()
  await dialog(page, "Archive Groceries?").getByRole("button", { name: "Archive" }).click()
  await expect(toast(page, "Category archived.")).toBeVisible()
  await expect(active(page).getByText("Groceries")).toHaveCount(0)
  await section(page).getByRole("button", { name: "Show archived (1)" }).click()
  await expect(archived(page).getByText("Groceries")).toBeVisible()
  await section(page).screenshot({ path: "e2e-screenshots/settings-categories.png" })

  await page.goto("/transactions")
  await expect(page.locator("main li").filter({ hasText: "Vegetables" })).toContainText("Groceries (archived)")
  await page.goto("/transactions?add=expense")
  await expect(dialog(page, "Add expense").getByLabel("Category").locator("option", { hasText: "Groceries" })).toHaveCount(0)
  await page.keyboard.press("Escape")

  // A new active "Groceries" blocks restoring the old one until one is renamed.
  await page.goto("/settings")
  await addCategory(page, "Groceries", "Groceries")
  await expect(toast(page, "Category added.")).toBeVisible()
  await section(page).getByRole("button", { name: "Show archived (1)" }).click()
  await archived(page).getByRole("button", { name: "Restore Groceries" }).click()
  await expect(toast(page, "An active category already has this name. Rename one of them first.")).toBeVisible()

  await active(page).getByRole("button", { name: "Rename Groceries" }).click()
  await dialog(page, "Rename Groceries").getByLabel("Name").fill("Groceries (new)")
  await dialog(page, "Rename Groceries").getByRole("button", { name: "Save" }).click()
  await expect(toast(page, "Category saved.")).toBeVisible()
  await archived(page).getByRole("button", { name: "Restore Groceries" }).click()
  await expect(toast(page, "Category restored.")).toBeVisible()
  await expect(active(page).getByText("Groceries", { exact: true })).toBeVisible()
})
