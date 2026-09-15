import { InsightsDashboard } from "@/components/insights-dashboard";
import { recentInsightsRange } from "@/lib/insights";
import { requireAdmin } from "@/lib/auth";

export default async function InsightsPage() {
  await requireAdmin();
  return <InsightsDashboard initialRange={recentInsightsRange()} />;
}
