import { Target } from "lucide-react-native";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RecurringSummaryCard } from "@/components/recurring/recurring-summary-card";
import { Screen } from "@/components/screen";
import { colors } from "@/theme";

// Holding screen until Sprint 13c builds Plan. Recurring (bills that repeat) already exists on
// mobile, so it is linked here; budgets, goals, loans and investments come later.
export default function PlanScreen() {
  return (
    <Screen aboveTabBar>
      <PageHeader title="Plan" description="Budgets, goals, loans and bills that repeat." />
      <RecurringSummaryCard />
      <EmptyState
        icon={Target}
        chip={colors.lavender}
        title="Budgets, goals and loans"
        body="These are coming to the app in a later update."
        action={<Badge label="Soon" tone="info" />}
      />
    </Screen>
  );
}
