"use client";

import { useState, type ChangeEvent } from "react";
import {
  HISTORICAL_IMPORT_CONFIRMATION,
  HISTORICAL_IMPORT_MAX_BYTES,
  type HistoricalImportApplyResult,
  type HistoricalImportPreview,
} from "@/lib/admin-historical-import";

type Props = {
  open: boolean;
  onClose: () => void;
  onApplied: (message: string) => void;
};

type ApiPayload = {
  result?: HistoricalImportPreview | HistoricalImportApplyResult;
  error?: string;
  errors?: string[];
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function AdminHistoricalImportModal({ open, onClose, onApplied }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [checksum, setChecksum] = useState("");
  const [preview, setPreview] = useState<HistoricalImportPreview | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  function resetPreview() {
    setCsvText("");
    setChecksum("");
    setPreview(null);
    setReason("");
    setConfirmation("");
    setMessage(null);
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    resetPreview();
  }

  async function request(action: "preview" | "apply") {
    if (!file || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (file.size > HISTORICAL_IMPORT_MAX_BYTES) {
        setMessage("حجم ملف CSV يتجاوز 2 MiB.");
        return;
      }

      const currentText = action === "preview" ? await file.text() : csvText;
      const currentChecksum = action === "preview" ? await sha256(currentText) : checksum;
      const response = await fetch("/api/admin/historical-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action,
          csv_text: currentText,
          source_filename: file.name,
          source_sha256: currentChecksum,
          reason,
          confirmation,
          preview_token: preview?.preview_token ?? null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiPayload;
      if (!response.ok || !payload.result) {
        setMessage([payload.error, ...(payload.errors ?? [])].filter(Boolean).join(" · ") || "تعذر تنفيذ طلب الاستيراد.");
        return;
      }

      if (payload.result.dry_run) {
        setCsvText(currentText);
        setChecksum(currentChecksum);
        setPreview(payload.result);
        setMessage(payload.result.invalid_rows === 0 ? "اكتملت المعاينة وكل الصفوف صالحة." : "اكتملت المعاينة، ويجب إصلاح كل الأخطاء قبل التطبيق.");
      } else {
        onApplied(`تم استيراد ${payload.result.inserted_items.toLocaleString("en-US")} مادة تاريخية. رقم الدفعة: ${payload.result.batch_id}`);
        setFile(null);
        resetPreview();
        onClose();
      }
    } catch {
      setMessage("تعذر قراءة الملف أو إرسال الطلب.");
    } finally {
      setBusy(false);
    }
  }

  const canApply = Boolean(
    preview
    && preview.invalid_rows === 0
    && preview.valid_rows > 0
    && reason.trim().length >= 5
    && reason.trim().length <= 500
    && confirmation === HISTORICAL_IMPORT_CONFIRMATION
    && !busy,
  );

  return (
    <div className="veil" onClick={() => !busy && onClose()}>
      <section
        aria-labelledby="historical-import-title"
        aria-modal="true"
        className="confirm-panel create-item-panel stack"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="screen-head">
          <div>
            <p className="eyebrow">الأدمن</p>
            <h2 id="historical-import-title">استيراد السجل التاريخي</h2>
          </div>
          <button className="icon-button" type="button" disabled={busy} onClick={onClose} aria-label="إغلاق">×</button>
        </header>

        <p className="soft-banner">هذه الأداة للسجل المنشور قبل الحد التاريخي المعتمد فقط. لا تمر المواد المستوردة بمسار المسودات المعتاد.</p>
        <p className="muted">الأعمدة المطلوبة: <span className="num">title, permalink, published_at</span>. الأعمدة الاختيارية: <span className="num">track, idea_type, partners, caption, notes</span>. افصل أسماء الشركاء بعلامة <span className="num">|</span>.</p>

        <label className="field">
          ملف CSV
          <input className="input" type="file" accept=".csv,text/csv" onChange={selectFile} />
        </label>
        <button className="button button-secondary" type="button" disabled={!file || busy} onClick={() => request("preview")}>فحص ومعاينة</button>

        {message ? <p className="notice" role="status">{message}</p> : null}

        {preview ? (
          <div className="stack">
            <div className="pill-row">
              <span className="pill">الصفوف: <span className="num">{preview.total_rows.toLocaleString("en-US")}</span></span>
              <span className="pill">الصالحة: <span className="num">{preview.valid_rows.toLocaleString("en-US")}</span></span>
              <span className="pill">غير الصالحة: <span className="num">{preview.invalid_rows.toLocaleString("en-US")}</span></span>
              <span className="pill">المواد المقصودة: <span className="num">{preview.intended_items.toLocaleString("en-US")}</span></span>
              <span className="pill">المواعيد الجديدة: <span className="num">{preview.intended_new_slots.toLocaleString("en-US")}</span></span>
            </div>
            <p className="muted">بصمة SHA-256 أدناه حُسبت بواسطة واجهة الاستيراد المعتمدة للتحقق من ثبات محتوى الطلب، وليست دليلاً مستقلاً على الملف الأصلي.</p>
            <code className="read-box num" dir="ltr">{preview.source_sha256}</code>
            <div className="table-wrap">
              <table className="preview-table">
                <thead><tr><th>السطر</th><th>الحالة</th><th>القيم المحلولة</th><th>الأخطاء</th></tr></thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={`${row.csv_line ?? "invalid"}-${index}`}>
                      <td className="num">{row.csv_line?.toLocaleString("en-US") ?? "—"}</td>
                      <td>{row.valid ? "صالح" : "مرفوض"}</td>
                      <td>
                        <strong>{row.resolved.title ?? "—"}</strong><br />
                        <span className="num" dir="ltr">{row.resolved.permalink ?? "—"}</span><br />
                        {row.resolved.track ?? "—"} · {row.resolved.idea_type ?? "—"} · {row.resolved.partners.join("، ") || "—"}
                      </td>
                      <td className={row.valid ? "muted" : "error"}>{row.errors.join(" · ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="field">سبب الاستيراد<textarea className="input textarea" required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
            <label className="field">اكتب عبارة التأكيد: <strong>{HISTORICAL_IMPORT_CONFIRMATION}</strong><input className="input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
            <button className="button" type="button" disabled={!canApply} onClick={() => request("apply")}>تطبيق الدفعة كاملة</button>
            <p className="muted">لا يوجد تطبيق جزئي. إذا فشل أي صف فلن تُحفظ أي مادة.</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
