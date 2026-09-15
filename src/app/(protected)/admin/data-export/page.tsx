import { requireAdmin } from "@/lib/auth";

export default async function DataExportPage() {
  await requireAdmin();
  return (
    <main className="page wide-page stack">
      <header className="screen-head">
        <div>
          <p className="eyebrow">للمدير فقط</p>
          <h1>تصدير بيانات الذكاء الاصطناعي</h1>
          <p className="muted">ملف JSON يجمع المواد والمواعيد والتكليفات وسجل الحالات وتحليلات إنستغرام من الموقع.</p>
        </div>
      </header>
      <section className="card stack">
        <h2>تصدير آمن</h2>
        <p>يتم استثناء شهري ٤ و٥ تلقائيًا. لا يتم حذف أي بيانات من قاعدة البيانات أو من جدول المتابعات.</p>
        <a className="button" href="/api/admin/data-export">تنزيل ملف JSON</a>
      </section>
    </main>
  );
}
