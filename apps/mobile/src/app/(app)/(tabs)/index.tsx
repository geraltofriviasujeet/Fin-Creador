import { useRouter } from "expo-router";
import { Inbox, UserRound } from "lucide-react-native";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";

// First-run empty state, as on web. The real dashboard is Sprint 5; no figures are shown
// until they come from the user's own data.
export default function OverviewScreen() {
  const router = useRouter();
  return (
    <Screen>
      <PageHeader title="Overview" description="Your money at a glance, once you start recording it." />
      <EmptyState
        icon={Inbox}
        title="Nothing to show yet"
        body="Your balance, income and spending will appear here after you add accounts and transactions. Start by setting your country, currency and time zone."
        action={<Button label="Set up your profile" icon={UserRound} onPress={() => router.push("/settings")} />}
      />
    </Screen>
  );
}
