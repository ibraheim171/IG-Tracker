export function MetricDefinitions() {
  return <details className="card metric-definitions">
    <summary>تعريف المقاييس والمعادلات</summary>
    <div className="stack compact-stack">
      <p><b>الوصول D1 / D7 / D30:</b> قياس الوصول عند عمر المادة المحدد بالضبط؛ غياب النقطة يعني «—».</p>
      <p><b>وسيط الحفظ:</b> <span className="num">saved / reach × 100</span></p>
      <p><b>وسيط المشاركة:</b> <span className="num">shares / reach × 100</span></p>
      <p><b>وسيط المتابعة:</b> <span className="num">follows / reach × 100</span></p>
      <p><b>قوة الإشارة:</b> <span className="num">(6×shares + 4×saved + 3×follows + 2×profile_visits + 1.5×comments + 0.5×likes) / reach × 1000</span></p>
      <p className="muted"><span className="num">N</span> هو عدد المواد التي تحمل قياسًا فعليًا للمقياس المختار، وليس عدد المواد المرتبطة فقط.</p>
    </div>
  </details>;
}
