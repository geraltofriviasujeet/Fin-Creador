import type * as React from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ChevronRight, FlaskConical, Plus } from "lucide-react"
import { LogoMark, Wordmark } from "@/components/brand/logo"
import { PageHeader } from "@/components/shell/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FormMessage, SelectField, TextField } from "@/components/ui/field"
import { demoGoals, demoTransactions } from "./_samples/demo-data"
import { AddGoalButton, BudgetDonut, GoalRow, SummaryCards, TransactionRow } from "./_samples/samples"
import { ToastDemo } from "./_samples/toast-demo"

export const metadata: Metadata = { title: "Design review", robots: { index: false, follow: false } }

// Dev-only review page (design-spec §8). Returns 404 in production builds.
export default function DesignReviewPage() {
  if (process.env.NODE_ENV === "production") notFound()

  return (
    <>
      <div
        role="note"
        className="mb-6 flex items-center gap-3 rounded-xl border border-dashed border-line-strong bg-chip-blue px-4 py-3 text-sm"
      >
        <FlaskConical aria-hidden="true" className="size-5 shrink-0" />
        <p>
          <strong className="font-semibold">Demo data.</strong> This development-only page shows sample
          figures to compare against the Figma design. None of it is real financial information.
        </p>
      </div>

      <PageHeader eyebrow="Design review" title="Primitives & samples" description="Tokens, brand and shared components." />

      <div className="grid gap-8">
        <Section title="Brand">
          <div className="flex flex-wrap gap-4">
            <div className="on-dark flex items-center gap-2.5 rounded-2xl bg-nav px-6 py-5">
              <LogoMark />
              <Wordmark tone="onDark" />
            </div>
            <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-6 py-5">
              <LogoMark />
              <Wordmark tone="onLight" />
            </div>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>
              <Plus aria-hidden="true" />
              Add transaction
            </Button>
            <Button variant="secondary">Cancel</Button>
            <Button variant="brand">Highlight</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Delete</Button>
            <Button variant="link">Text link</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Add">
              <Plus aria-hidden="true" />
            </Button>
            <Button size="icon-sm" variant="secondary" aria-label="Next">
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </Section>

        <Section title="Inputs">
          <div className="grid max-w-2xl gap-5 md:grid-cols-2">
            <TextField name="demo-email" type="email" label="Email" placeholder="you@example.com" />
            <TextField name="demo-hint" label="With hint" hint="Helper text sits under the field." />
            <TextField name="demo-error" label="With error" defaultValue="not-an-email" error="Enter a valid email address" />
            <SelectField name="demo-select" label="Select" defaultValue="UPI">
              {["UPI", "Cash", "Debit card", "Credit card", "Bank transfer"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </SelectField>
            <TextField name="demo-disabled" label="Disabled" defaultValue="Read only value" disabled />
          </div>
          <div className="mt-5 grid max-w-2xl gap-3">
            <FormMessage tone="error">Something went wrong. Your input was kept — try again.</FormMessage>
            <FormMessage tone="info">Informational message.</FormMessage>
            <FormMessage tone="success">Changes saved.</FormMessage>
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="positive">+12.5%</Badge>
            <Badge tone="negative">+4.2%</Badge>
            <Badge tone="savings">Savings</Badge>
            <Badge tone="info">Housing</Badge>
            <Badge tone="neutral">Neutral</Badge>
            <span className="on-dark rounded-lg bg-brand-deep p-2">
              <Badge tone="onDark">+8.4%</Badge>
            </span>
          </div>
        </Section>

        <Section title="Toasts">
          <ToastDemo />
        </Section>

        <Section title="Summary cards (demo data)">
          <SummaryCards />
        </Section>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Recent transactions</CardTitle>
                <CardDescription className="mt-1">Demo data</CardDescription>
              </div>
              <Button variant="link" size="sm" className="text-success">
                View all
                <ChevronRight aria-hidden="true" />
              </Button>
            </CardHeader>
            <ul className="mt-3">
              {demoTransactions.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} />
              ))}
            </ul>
          </Card>
          <BudgetDonut />
        </div>

        <Card className="max-w-xl">
          <CardHeader>
            <div>
              <CardTitle>Your goals</CardTitle>
              <CardDescription className="mt-1">Demo data</CardDescription>
            </div>
            <AddGoalButton />
          </CardHeader>
          <ul className="mt-2">
            {demoGoals.map((goal) => (
              <GoalRow key={goal.id} goal={goal} />
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}
