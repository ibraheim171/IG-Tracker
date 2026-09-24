import { MonthlyReportWorkspace } from "@/components/reports/monthly-report-workspace";
import { requireAdmin } from "@/lib/auth";

export default async function MonthlyReportsPage() {
  await requireAdmin();
  return <MonthlyReportWorkspace />;
}
