import type { Json, TablesInsert } from "./database.types.ts";

export const ANALYTICS_FORMULA_VERSION = "analytics-formulas-v1";
export const reportBlockTypes = ["account", "comparison", "partner_track", "posts", "audience"] as const;
export const reportWarningCodes = ["small_sample", "incomplete_measurement", "reels_structural_limits", "meta_demographics_snapshot", "partial_range"] as const;
export const reportMetrics = ["account_overview", "audience_snapshot", "posts_snapshot", "reach_d1", "reach_d7", "reach_d30", "save_rate", "share_rate", "follow_rate", "signal", "item_count"] as const;
export type ReportBlockType = typeof reportBlockTypes[number];
export type ReportWarningCode = typeof reportWarningCodes[number];
export type ReportMetric = typeof reportMetrics[number];
export type ReportSnapshotValue = { label: string; value: number | null; measured_n: number; total_n?: number };
export type ReportSelection = { key: string; label: string };
export type ReportSeries = { key: string; label: string; points: Array<{ date: string; value: number | null }> };
export type ReportContextSnapshot = {
  period: { start: string; end: string } | null;
  filters: Record<string, string | null>;
  metric: ReportMetric;
  formula: string;
  selection: ReportSelection[];
  values: ReportSnapshotValue[];
  series: ReportSeries[];
  completeness: { measured_n: number; expected_n: number } | null;
  warnings: ReportWarningCode[];
  source_time: string | null;
};
export type ValidReportContextBlock = { blockType: ReportBlockType; title: string; snapshot: ReportContextSnapshot };

const warningLabels: Record<ReportWarningCode, string> = {
  small_sample: "عيّنة صغيرة",
  incomplete_measurement: "قياس ناقص",
  reels_structural_limits: "قياسات ريلز ناقصة بنيويًا من Meta",
  meta_demographics_snapshot: "بيانات الجمهور لقطة تراكمية وليست قياسًا يوميًا",
  partial_range: "الفترة تحمل أيامًا غير مقاسة",
};

export const reportMetricFormulas: Record<ReportMetric, string> = {
  account_overview: "المتابعون: آخر قياس؛ التغير: آخر قياس ناقص أول قياس؛ إجماليات الوصول والمشاهدات تظهر فقط عند اكتمال أيام الفترة",
  audience_snapshot: "قيم ديموغرافية تراكمية كما أعادتها أحدث لقطة من Meta",
  posts_snapshot: "قيم كل منشور من أحدث لقطة محفوظة دون تجميع",
  reach_d1: "وسيط الوصول عند عمر يوم واحد بالضبط",
  reach_d7: "وسيط الوصول عند عمر 7 أيام بالضبط",
  reach_d30: "وسيط الوصول عند عمر 30 يومًا بالضبط",
  save_rate: "معدل الحفظ = الحفظ ÷ الوصول × 100",
  share_rate: "معدل المشاركة = المشاركات ÷ الوصول × 100",
  follow_rate: "معدل المتابعة = المتابعات ÷ الوصول × 100",
  signal: "قوة الإشارة = (6×المشاركات + 4×الحفظ + 3×المتابعات + 2×زيارات الملف + 1.5×التعليقات + 0.5×الإعجابات) ÷ الوصول × 1000",
  item_count: "عدد المواد المنشورة المطابقة للمرشحات",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateReportContextBlock(input: unknown): { ok: true; value: ValidReportContextBlock } | { ok: false; code: string; message: string } {
  if (!isRecord(input)) return { ok: false, code: "E_BLOCK", message: "بيانات المقطع غير صحيحة." };
  const { blockType, snapshot } = input;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!reportBlockTypes.includes(blockType as ReportBlockType) || title.length < 1 || title.length > 160 || !isRecord(snapshot)) return { ok: false, code: "E_BLOCK", message: "بيانات المقطع غير صحيحة." };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 65536) return { ok: false, code: "E_BLOCK_SIZE", message: "حجم المقطع أكبر من الحد المسموح." };

  const period = snapshot.period;
  if (period !== null && (!isRecord(period) || !isoDate(period.start) || !isoDate(period.end) || period.start > period.end)) return { ok: false, code: "E_PERIOD", message: "فترة المقطع غير صحيحة." };
  if (!isRecord(snapshot.filters) || Object.entries(snapshot.filters).some(([key, value]) => !key || value !== null && typeof value !== "string")) return { ok: false, code: "E_FILTERS", message: "مرشحات المقطع غير صحيحة." };
  if (!reportMetrics.includes(snapshot.metric as ReportMetric) || snapshot.formula !== reportMetricFormulas[snapshot.metric as ReportMetric]) return { ok: false, code: "E_METRIC", message: "تعريف مقياس المقطع غير صحيح." };
  if (!Array.isArray(snapshot.selection) || snapshot.selection.length > 100 || snapshot.selection.some((row) => !isRecord(row) || typeof row.key !== "string" || !row.key.trim() || typeof row.label !== "string" || !row.label.trim())) return { ok: false, code: "E_SELECTION", message: "اختيارات المقطع غير صحيحة." };
  if (!Array.isArray(snapshot.values) || snapshot.values.length < 1 || snapshot.values.length > 100) return { ok: false, code: "E_VALUES", message: "قيم المقطع غير صحيحة." };
  const values: ReportSnapshotValue[] = [];
  for (const raw of snapshot.values) {
    if (!isRecord(raw) || typeof raw.label !== "string" || raw.label.trim().length < 1 || raw.label.length > 160
      || raw.value !== null && (typeof raw.value !== "number" || !Number.isFinite(raw.value))
      || !Number.isInteger(raw.measured_n) || (raw.measured_n as number) < 0
      || raw.total_n !== undefined && (!Number.isInteger(raw.total_n) || (raw.total_n as number) < 0 || (raw.measured_n as number) > (raw.total_n as number))
      || raw.value !== null && raw.measured_n === 0) {
      return { ok: false, code: "E_VALUES", message: "قيم المقطع غير صحيحة." };
    }
    values.push({ label: raw.label.trim(), value: raw.value as number | null, measured_n: raw.measured_n as number, ...(raw.total_n === undefined ? {} : { total_n: raw.total_n as number }) });
  }
  if (!Array.isArray(snapshot.series) || snapshot.series.length > 20 || snapshot.series.some((series) => !isRecord(series) || typeof series.key !== "string" || !series.key.trim() || typeof series.label !== "string" || !series.label.trim() || !Array.isArray(series.points) || series.points.length > 366 || series.points.some((point) => !isRecord(point) || !isoDate(point.date) || point.value !== null && (typeof point.value !== "number" || !Number.isFinite(point.value))))) return { ok: false, code: "E_SERIES", message: "سلاسل المقطع غير صحيحة." };
  if (snapshot.completeness !== null && (!isRecord(snapshot.completeness) || !Number.isInteger(snapshot.completeness.measured_n) || !Number.isInteger(snapshot.completeness.expected_n) || (snapshot.completeness.measured_n as number) < 0 || (snapshot.completeness.expected_n as number) < 0 || (snapshot.completeness.measured_n as number) > (snapshot.completeness.expected_n as number))) return { ok: false, code: "E_COMPLETENESS", message: "اكتمال المقطع غير صحيح." };
  if (!Array.isArray(snapshot.warnings) || snapshot.warnings.some((warning) => !reportWarningCodes.includes(warning as ReportWarningCode))) return { ok: false, code: "E_WARNINGS", message: "تحذيرات المقطع غير صحيحة." };
  if (snapshot.source_time !== null && (typeof snapshot.source_time !== "string" || Number.isNaN(Date.parse(snapshot.source_time)))) return { ok: false, code: "E_SOURCE_TIME", message: "وقت المصدر غير صحيح." };
  const filters = Object.fromEntries(Object.entries(snapshot.filters).map(([key, value]) => [key, value as string | null]));
  return { ok: true, value: { blockType: blockType as ReportBlockType, title, snapshot: { period: period as ReportContextSnapshot["period"], filters, metric: snapshot.metric as ReportMetric, formula: snapshot.formula as string, selection: snapshot.selection as ReportSelection[], values, series: snapshot.series as ReportSeries[], completeness: snapshot.completeness as ReportContextSnapshot["completeness"], warnings: snapshot.warnings as ReportWarningCode[], source_time: snapshot.source_time as string | null } } };
}

export function displaySnapshotValue(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function cell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function composeMonthlyReportInput(
  report: { title: string; month: string; context_note: string | null },
  blocks: Array<{ title: string; block_type: string; input_snapshot: unknown; formula_version: string }>,
) {
  const sections = blocks.map((block, index) => {
    if (block.formula_version !== ANALYTICS_FORMULA_VERSION) throw new Error("INVALID_STORED_REPORT_CONTEXT");
    const validated = validateReportContextBlock({ blockType: block.block_type, title: block.title, snapshot: block.input_snapshot });
    if (!validated.ok) throw new Error("INVALID_STORED_REPORT_CONTEXT");
    const snapshot = validated.value.snapshot;
    const filters = Object.entries(snapshot.filters).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value ?? "—"}`).join("، ") || "—";
    const selection = snapshot.selection.map((row) => `${row.key}=${row.label}`).join("، ") || "—";
    const rows = snapshot.values.map((row) => `| ${cell(row.label)} | ${displaySnapshotValue(row.value)} | N=${row.measured_n.toLocaleString("en-US")} | ${row.total_n === undefined ? "—" : row.total_n.toLocaleString("en-US")} |`).join("\n");
    const warnings = snapshot.warnings.length ? snapshot.warnings.map((warning) => `- ${warningLabels[warning]}`).join("\n") : "- لا توجد تحذيرات مسجلة";
    const completeness = snapshot.completeness ? `${snapshot.completeness.measured_n}/${snapshot.completeness.expected_n}` : "—";
    const series = snapshot.series.map((entry) => `- ${entry.key} (${entry.label}): ${entry.points.map((point) => `${point.date}=${displaySnapshotValue(point.value)}`).join("، ")}`).join("\n") || "- —";
    return `## ${index + 1}. ${block.title}\n\n- النوع: ${block.block_type}\n- المقياس: ${snapshot.metric}\n- المعادلة: ${snapshot.formula}\n- الفترة: ${snapshot.period ? `${snapshot.period.start} — ${snapshot.period.end}` : "غير مرتبطة بنطاق يومي"}\n- المرشحات: ${filters}\n- الاختيارات الثابتة: ${selection}\n- اكتمال القياس: ${completeness}\n- وقت المصدر: ${snapshot.source_time ?? "—"}\n- إصدار المعادلات: ${block.formula_version}\n\n| القيمة | الرقم | العينة المقاسة | المواد المرتبطة |\n|---|---:|---:|---:|\n${rows}\n\n### السلاسل المحفوظة\n${series}\n\n### تحذيرات البيانات\n${warnings}`;
  });
  return `# مدخل تقرير ${report.title}\n\n- الشهر: ${report.month}\n- إصدار المعادلات: ${ANALYTICS_FORMULA_VERSION}\n\n## السياق البشري\n\n${report.context_note?.trim() || "—"}\n\n${sections.join("\n\n")}`;
}

export function buildMonthlyDraftRow(actorId: string, reportId: string, input: string): TablesInsert<"ai_drafts"> {
  return {
    kind: "monthly_report",
    report_id: reportId,
    input_snapshot: { markdown: input } satisfies Json,
    output: `مسودة آلية — تحتاج اعتمادًا\n\n${input}`,
    model: null,
    created_by: actorId,
    approved_by: null,
    approved_at: null,
  };
}
