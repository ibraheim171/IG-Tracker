export function DataCoverage({ measured, expected, label = "تغطية البيانات" }: { measured: number; expected: number; label?: string }) {
  const safeExpected = Math.max(expected, 1);
  return (
    <div className="data-coverage">
      <span>{label}: <b className="num">{measured.toLocaleString("en-US")}</b> من <b className="num">{expected.toLocaleString("en-US")}</b> يومًا</span>
      <meter min={0} max={safeExpected} value={Math.min(measured, safeExpected)} aria-label={`${label}: ${measured} من ${expected} يومًا`} />
    </div>
  );
}
