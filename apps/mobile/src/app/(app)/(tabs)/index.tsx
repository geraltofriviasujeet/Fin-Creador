import { useRouter } from "expo-router";
import { Inbox, UserRound } from "lucide-react-native";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { IncomeSummaryCard } from "@/components/income/income-summary-card";
import { RecurringSummaryCard } from "@/components/recurring/recurring-summary-card";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";

// Income and Recurring cards (real figures from the user's data) and the first-run state. The full
// dashboard is Sprint 5.
export default function OverviewScreen() {
  const router = useRouter();
  return (
    <Screen>
      <PageHeader title="Overview" description="Your money at a glance, once you start recording it." />
      <IncomeSummaryCard />
      <RecurringSummaryCard />
      <EmptyState
        icon={Inbox}
        title="Nothing to show yet"
        body="Your balance, income and spending will appear here as you record them. Start by setting your country, currency and time zone."
        action={<Button label="Set up your profile" icon={UserRound} onPress={() => router.push("/settings")} />}
      />
    </Screen>
  );
}
