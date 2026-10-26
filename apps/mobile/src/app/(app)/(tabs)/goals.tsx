import { Goal } from "lucide-react-native";
import { ComingSoon } from "@/components/coming-soon";

export default function GoalsScreen() {
  return <ComingSoon label="Goals" icon={Goal} description="Planned expenses and monthly budgets." />;
}
