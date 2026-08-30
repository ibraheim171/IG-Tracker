export default function ProtectedLoading() {
  return (
    <main className="page wide-page stack route-loading" aria-live="polite" aria-label="جاري تحميل الصفحة">
      <header className="screen-head">
        <div className="loading-heading">
          <span className="skeleton skeleton-short" />
          <span className="skeleton skeleton-title" />
        </div>
        <span className="loading-label">جاري التحميل…</span>
      </header>
      <div className="loading-list" aria-hidden="true">
        <span className="skeleton skeleton-rule" />
        <span className="skeleton skeleton-card" />
        <span className="skeleton skeleton-card" />
        <span className="skeleton skeleton-card" />
      </div>
    </main>
  );
}
