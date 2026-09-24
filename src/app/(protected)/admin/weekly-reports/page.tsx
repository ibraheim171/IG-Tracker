import { WeeklyReportsManager } from "@/components/weekly-reports-manager";
import { requireAdmin } from "@/lib/auth";

export default async function WeeklyReportsPage() {
  await requireAdmin();
  return <WeeklyReportsManager />;
}
