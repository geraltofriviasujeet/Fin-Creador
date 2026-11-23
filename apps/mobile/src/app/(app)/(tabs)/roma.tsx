import { Sparkles } from "lucide-react-native";
import { ComingSoon } from "@/components/coming-soon";

// Holding screen until Sprint 13d builds Roma on mobile.
export default function RomaScreen() {
  return <ComingSoon label="Roma" icon={Sparkles} description="Your Intelligent Finance Agent." />;
}
