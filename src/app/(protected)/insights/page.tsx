import { InsightsDashboard } from "@/components/insights-dashboard";
import { currentWeekRange } from "@/lib/insights";
import { requireAdmin } from "@/lib/auth";

export default async function InsightsPage() {
  await requireAdmin();
  return <InsightsDashboard initialRange={currentWeekRange()} />;
}
