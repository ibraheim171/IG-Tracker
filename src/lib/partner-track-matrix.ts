import type { ComparisonResult } from "./analytics-comparison.ts";

export type MatrixPartner = { partner_id: string; name: string };
export type MatrixTrack = { track_id: string; name: string };
export type MatrixCell = { value: number | null; total_n: number; measured_n: number; is_thin: boolean; has_partial_reels: boolean };

export function buildPartnerTrackMatrix(partners: MatrixPartner[], tracks: MatrixTrack[], rows: ComparisonResult[]) {
  const measured = new Map(rows.map((row) => [row.dimension_key, {
    value: row.median_value,
    total_n: row.total_n,
    measured_n: row.measured_n,
    is_thin: row.is_thin,
    has_partial_reels: row.has_partial_reels,
  } satisfies MatrixCell]));
  const cells = new Map<string, MatrixCell>();
  for (const partner of partners) for (const track of tracks) {
    const key = `${partner.partner_id}:${track.track_id}`;
    cells.set(key, measured.get(key) ?? { value: null, total_n: 0, measured_n: 0, is_thin: false, has_partial_reels: false });
  }
  const values = [...cells.values()].flatMap((cell) => cell.value === null ? [] : [Math.abs(cell.value)]);
  return { partners, tracks, cells, maximum: Math.max(...values, 1) };
}
