"use client";

import { useId } from "react";
import { lineSegments, type ChartPoint } from "@/lib/account-pulse";

export type MetricChartSeries = {
  label: string;
  points: ChartPoint<string>[];
};

const width = 720;
const height = 248;
const padding = { top: 18, right: 18, bottom: 34, left: 58 };

function metric(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function MetricLineChart({ title, series, sourceTime = null }: { title: string; series: MetricChartSeries[]; sourceTime?: string | null }) {
  const titleId = useId();
  const descriptionId = useId();
  const dates = [...new Set(series.flatMap((entry) => entry.points.map((point) => point.x)))].sort();
  const measured = series.flatMap((entry) => entry.points.flatMap((point) => point.y === null ? [] : [point.y]));
  const minimum = Math.min(...measured, 0);
  const maximum = Math.max(...measured, 1);
  const span = Math.max(maximum - minimum, 1);
  const x = (date: string) => padding.left + (Math.max(dates.indexOf(date), 0) / Math.max(dates.length - 1, 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + (1 - (value - minimum) / span) * (height - padding.top - padding.bottom);
  const formatPath = (points: Array<{ x: string; y: number }>) => points.map((point, index) => `${index ? "L" : "M"}${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`).join(" ");
  const description = series.map((entry) => {
    const values = entry.points.filter((point): point is { x: string; y: number } => point.y !== null);
    return `${entry.label}: ${values.length} قياسات من ${entry.points.length}`;
  }).join(". ");

  if (!dates.length || !measured.length) return <div className="chart-empty muted">لا توجد قياسات متاحة للرسم ضمن هذه الفترة.</div>;

  return (
    <div className="metric-chart">
      <div className="chart-legend" aria-hidden="true">
        {series.map((entry, index) => <span key={entry.label}><i className={`chart-swatch chart-series-${index}`} />{entry.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${titleId} ${descriptionId}`} preserveAspectRatio="none">
        <title id={titleId}>{title}</title>
        <desc id={descriptionId}>{description}. الأيام التي لا تحمل قياسًا تظهر كفجوات.</desc>
        {[0, 0.5, 1].map((ratio) => {
          const gridY = padding.top + ratio * (height - padding.top - padding.bottom);
          const value = maximum - span * ratio;
          return <g key={ratio}><line className="chart-grid-line" x1={padding.left} x2={width - padding.right} y1={gridY} y2={gridY} /><text className="chart-axis-label" x={padding.left - 8} y={gridY + 4}>{metric(value)}</text></g>;
        })}
        {series.map((entry, seriesIndex) => lineSegments(entry.points).map((segment, segmentIndex) => (
          <g key={`${entry.label}-${segmentIndex}`}>
            {segment.length > 1 ? <path className={`chart-line chart-series-${seriesIndex}`} d={formatPath(segment)} /> : null}
            {segment.map((point) => <circle className={`chart-dot chart-series-${seriesIndex}`} cx={x(point.x)} cy={y(point.y)} r="3.5" key={point.x}><title>{entry.label} · {point.x} · القيمة: {metric(point.y)} · الحالة: مقاس · وقت المصدر: {sourceTime ?? "—"}</title></circle>)}
          </g>
        )))}
        <text className="chart-date-label" x={padding.left} y={height - 8}>{dates[0]}</text>
        <text className="chart-date-label" textAnchor="end" x={width - padding.right} y={height - 8}>{dates.at(-1)}</text>
      </svg>
    </div>
  );
}
