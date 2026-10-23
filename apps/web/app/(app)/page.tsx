import Link from "next/link"
import { ArrowDownToLine, Inbox, UserRound } from "lucide-react"
import { PageHeader } from "@/components/shell/app-shell"
import { cn } from "cn"
import { buttonVariants } from "@/components/ui/button"
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
            Your balance, income and spending will appear here as you record them. Add your
            accounts and income on the Income page.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/income" className={cn(buttonVariants())}>
            <ArrowDownToLine aria-hidden="true" />
            Go to Income
          </Link>
          <Link href="/settings" className={cn(buttonVariants({ variant: "secondary" }))}>
            <UserRound aria-hidden="true" />
            Set up your profile
          </Link>
        </div>
      </Card>
    </>
  )
}
