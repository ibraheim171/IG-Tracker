import type { ComparisonResult } from "@/lib/analytics-comparison";

const partLabels: Record<string, string> = { writer: "الكتابة", producer: "الإنتاج", reviewer: "المراجعة" };

function metric(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function ComparisonChart({ rows, metricLabel }: { rows: ComparisonResult[]; metricLabel: string }) {
  const maximum = Math.max(...rows.flatMap((row) => row.median_value === null ? [] : [Math.abs(row.median_value)]), 1);
  if (!rows.length) return <p className="muted">لا توجد قياسات للعناصر المحددة ضمن هذه الفترة.</p>;
  return <div className="comparison-chart" role="img" aria-label={`مقارنة ${metricLabel}. كل صف يعرض القيمة وحجم العينة المقاسة.`}>
    {rows.map((row) => <article className={`comparison-row${row.is_thin ? " is-thin" : ""}`} key={`${row.dimension_key}-${row.participant_part ?? "all"}`}>
      <div className="comparison-row-head">
        <strong>{row.dimension_name}{row.participant_part ? ` — ${partLabels[row.participant_part] ?? row.participant_part}` : ""}</strong>
        <span className="num">{metric(row.median_value)}</span>
      </div>
      <div className="comparison-track" aria-hidden="true">{row.median_value !== null ? <i style={{ inlineSize: `${Math.abs(row.median_value) / maximum * 100}%` }} /> : null}</div>
      <div className="comparison-meta">
        <span className="comparison-n num">N={row.measured_n.toLocaleString("en-US")}</span>
        <span>مواد مرتبطة: <b className="num">{row.total_n.toLocaleString("en-US")}</b></span>
        {row.is_thin ? <span className="metric-flag">عيّنة صغيرة</span> : null}
      </div>
    </article>)}
  </div>;
}
