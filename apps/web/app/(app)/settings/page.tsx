import type { Metadata } from "next"
import { COUNTRY_CODES, PROFILE_DEFAULTS, listCurrencies, listTimeZones } from "@fin-creador/schemas"
import { updateProfileAction } from "@/app/(app)/settings/actions"
import { PageHeader } from "@/components/shell/app-shell"
import { ProfileForm, type Option } from "@/components/settings/profile-form"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"

export const metadata: Metadata = { title: "Settings" }

const LOCALE = "en-IN"

function countryOptions(): Option[] {
  const names = new Intl.DisplayNames([LOCALE], { type: "region" })
  return COUNTRY_CODES.map((code) => ({ value: code, label: names.of(code) ?? code })).sort((a, b) =>
    a.label.localeCompare(b.label, LOCALE)
  )
}

function currencyOptions(): Option[] {
  const names = new Intl.DisplayNames([LOCALE], { type: "currency" })
  return listCurrencies().map((code) => ({ value: code, label: `${code} — ${names.of(code) ?? code}` }))
}

function timeZoneOptions(): Option[] {
  return listTimeZones().map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }))
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Manage your profile and regional preferences." />
      <Card className="max-w-2xl">
        <CardTitle>Profile</CardTitle>
        <CardDescription className="mt-1">
          Country, currency and time zone decide how amounts are shown and where your days and
          months start.
        </CardDescription>
        <ProfileForm
          action={updateProfileAction}
          defaults={{ displayName: "", phone: "", ...PROFILE_DEFAULTS }}
          countries={countryOptions()}
          currencies={currencyOptions()}
          timeZones={timeZoneOptions()}
        />
      </Card>
    </>
  )
}
