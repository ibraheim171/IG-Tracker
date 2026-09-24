export type SyncHealthRow = { id: string; status: string; source_timestamp: string; received_at: string };

export function summarizeSyncHealth<T extends SyncHealthRow>(runs: T[], now: string, staleHours = 36) {
  const latest = runs[0] ?? null;
  const latestAccepted = runs.find((run) => run.status === "accepted") ?? null;
  const stale = latestAccepted
    ? Date.parse(now) - Date.parse(latestAccepted.source_timestamp) > staleHours * 3_600_000
    : true;
  return { latest, latestAccepted, latestFailed: Boolean(latest && latest.status !== "accepted"), stale };
}
