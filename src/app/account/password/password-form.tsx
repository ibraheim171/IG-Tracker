"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PasswordForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    const confirmation = String(form.get("confirmation"));
    if (password !== confirmation) { setError("كلمتا المرور غير متطابقتين."); return; }
    setLoading(true);
    const response = await fetch("/api/account/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (!response.ok) {
      const payload: unknown = await response.json();
      setError(isErrorResponse(payload) ? `${payload.error} [${payload.code}]` : "تعذر تغيير كلمة المرور.");
      setLoading(false);
      return;
    }
    router.replace("/health"); router.refresh();
  }

  return <form className="stack" onSubmit={submit}>
    <label className="field">كلمة المرور الجديدة<input className="input" name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
    <label className="field">تأكيد كلمة المرور<input className="input" name="confirmation" type="password" autoComplete="new-password" minLength={12} required /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="button" disabled={loading}>{loading ? "جارٍ الحفظ" : "حفظ كلمة المرور"}</button>
  </form>;
}

function isErrorResponse(value: unknown): value is { error: string; code: string } {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).error === "string" && typeof (value as Record<string, unknown>).code === "string";
}
