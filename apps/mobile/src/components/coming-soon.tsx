import type { LucideIcon } from "lucide-react-native";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Screen } from "@/components/screen";
import { comingSoonMessage } from "@/navigation";
import { colors } from "@/theme";

/** Placeholder for a section a later sprint builds. Shows no figures. */
export function ComingSoon({ label, icon, description }: { label: string; icon: LucideIcon; description: string }) {
  return (
    <Screen>
      <PageHeader title={label} description={description} />
      <EmptyState
        icon={icon}
        chip={colors.lavender}
        title="Coming soon"
        body={comingSoonMessage(label)}
        action={<Badge label="Soon" tone="info" />}
      />
    </Screen>
  );
}
