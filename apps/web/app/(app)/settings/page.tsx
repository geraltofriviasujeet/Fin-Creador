import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { LogOut } from "lucide-react"
import { PROFILE_FORM_COLUMNS, loadExpenseCategories, profileFormValues } from "@fin-creador/api"
import { countryOptions, currencyOptions, timeZoneOptions } from "@fin-creador/schemas"
import { signOutAction } from "@/app/(auth)/actions"
import { updateProfileAction } from "@/app/(app)/settings/actions"
import { PageHeader } from "@/components/shell/app-shell"
import { ExpenseCategories } from "@/components/settings/expense-categories"
import { ProfileForm } from "@/components/settings/profile-form"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Manage your profile, regional preferences and expense categories." />
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsContent />
      </Suspense>
    </>
  )
}

async function SettingsContent() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect("/sign-in?next=%2Fsettings")

  const [{ data: profile, error }, categories] = await Promise.all([
    supabase.from("profiles").select(PROFILE_FORM_COLUMNS).eq("id", auth.user.id).maybeSingle(),
    loadExpenseCategories(supabase),
  ])

  return (
    <div className="grid max-w-2xl gap-4">
      <Card>
        <CardTitle>Profile</CardTitle>
        <CardDescription className="mt-1">
          Country, currency and time zone decide how amounts are shown and where your days and
          months start.
        </CardDescription>
        {error || !profile ? (
          <FormMessage tone="error" className="mt-4">
            We couldn’t load your profile. Refresh the page to try again.
          </FormMessage>
        ) : (
          <ProfileForm
            action={updateProfileAction}
            defaults={profileFormValues(profile)}
            countries={countryOptions()}
            currencies={currencyOptions(profile.currency)}
            timeZones={timeZoneOptions(profile.time_zone)}
          />
        )}
      </Card>

      <Card>
        <CardTitle>Categories</CardTitle>
        <CardDescription className="mt-1">
          Expense categories for what you spend. Archived ones stay on past entries and can be
          restored. Income sources are on the Income page.
        </CardDescription>
        {categories.ok ? (
          <ExpenseCategories categories={categories.categories} />
        ) : (
          <FormMessage tone="error" className="mt-4">
            We couldn’t load your categories. Refresh the page to try again.
          </FormMessage>
        )}
      </Card>

      <Card>
        <CardTitle>Account</CardTitle>
        <CardDescription className="mt-1">Signed in as {auth.user.email}</CardDescription>
        <form action={signOutAction} className="mt-5">
          <Button type="submit" variant="secondary">
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </form>
      </Card>
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading settings" className="grid max-w-2xl gap-4">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="grid gap-4">
          <span className="h-5 w-32 rounded bg-canvas" />
          <span className="h-4 w-3/4 rounded bg-canvas" />
          <span className="h-11 w-full rounded-lg bg-canvas" />
        </Card>
      ))}
    </div>
  )
}
