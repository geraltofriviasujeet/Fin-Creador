import Link from "next/link"
import { Inbox, UserRound } from "lucide-react"
import { PageHeader } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

// First-run empty state. The real dashboard (summary cards, charts) is Sprint 5.
// No figures are shown until they come from the user's own data.
export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" description="Your money at a glance, once you start recording it." />
      <Card className="flex flex-col items-center gap-4 px-6 py-12 text-center md:py-16">
        <span className="flex size-12 items-center justify-center rounded-xl bg-chip-mint text-ink">
          <Inbox aria-hidden="true" className="size-6" />
        </span>
        <div className="grid max-w-md gap-1.5">
          <h2 className="text-xl font-semibold">Nothing to show yet</h2>
          <p className="text-sm text-muted-foreground">
            Your balance, income and spending will appear here after you add accounts and
            transactions. Start by setting your country, currency and time zone.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/settings" />}>
          <UserRound aria-hidden="true" />
          Set up your profile
        </Button>
      </Card>
    </>
  )
}
