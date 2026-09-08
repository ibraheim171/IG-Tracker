import { InsightsDashboard } from "@/components/insights-dashboard";
import { currentWeekRange } from "@/lib/insights";

export default function InsightsPage() {
  return <InsightsDashboard initialRange={currentWeekRange()} />;
}
