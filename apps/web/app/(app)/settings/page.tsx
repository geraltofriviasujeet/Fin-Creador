import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { LogOut } from "lucide-react"
import { COUNTRY_CODES, canonicalTimeZone, listCurrencies, listTimeZones } from "@fin-creador/schemas"
import { signOutAction } from "@/app/(auth)/actions"
import { updateProfileAction } from "@/app/(app)/settings/actions"
import { PageHeader } from "@/components/shell/app-shell"
import { ProfileForm, type Option } from "@/components/settings/profile-form"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { FormMessage } from "@/components/ui/field"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Settings" }

const LOCALE = "en-IN"

function countryOptions(): Option[] {
  const names = new Intl.DisplayNames([LOCALE], { type: "region" })
  return COUNTRY_CODES.map((code) => ({ value: code, label: names.of(code) ?? code })).sort((a, b) =>
    a.label.localeCompare(b.label, LOCALE)
  )
}

function currencyOptions(current: string): Option[] {
  const names = new Intl.DisplayNames([LOCALE], { type: "currency" })
  const codes = new Set([...listCurrencies(), current])
  return [...codes].sort().map((code) => ({ value: code, label: `${code} — ${names.of(code) ?? code}` }))
}

function timeZoneOptions(current: string): Option[] {
  const zones = new Set([...listTimeZones(), current])
  return [...zones].sort().map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }))
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Manage your profile and regional preferences." />
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

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("display_name, phone, country, currency, time_zone")
    .eq("id", auth.user.id)
    .maybeSingle()

  return (
    <div className="grid max-w-2xl gap-6">
      <Card>
        <CardTitle>Profile</CardTitle>
        <CardDescription className="mt-1">
          Country, currency and time zone decide how amounts are shown and where your days and
          months start.
        </CardDescription>
        {error || !profile ? (
          <FormMessage tone="error" className="mt-6">
            We couldn’t load your profile. Refresh the page to try again.
          </FormMessage>
        ) : (
          <ProfileForm
            action={updateProfileAction}
            defaults={{
              displayName: profile.display_name ?? "",
              phone: profile.phone ?? "",
              country: profile.country,
              currency: profile.currency,
              timeZone: canonicalTimeZone(profile.time_zone),
            }}
            countries={countryOptions()}
            currencies={currencyOptions(profile.currency)}
            timeZones={timeZoneOptions(canonicalTimeZone(profile.time_zone))}
          />
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
    <div aria-busy="true" aria-label="Loading settings" className="grid max-w-2xl gap-6">
      {[0, 1].map((i) => (
        <Card key={i} className="grid gap-4">
          <span className="h-5 w-32 rounded bg-canvas" />
          <span className="h-4 w-3/4 rounded bg-canvas" />
          <span className="h-11 w-full rounded-lg bg-canvas" />
        </Card>
      ))}
    </div>
  )
}
