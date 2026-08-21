"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
    const supabase = createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) { setError("انتهت الجلسة. سجّل الدخول مرة أخرى."); setLoading(false); return; }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) { setError("تعذر تغيير كلمة المرور."); setLoading(false); return; }
    const { error: profileError } = await supabase.from("profiles").update({ must_change_password: false }).eq("id", user.id);
    if (profileError) { setError("تم تغيير كلمة المرور، لكن تعذر تأكيدها. حاول مجدداً."); setLoading(false); return; }
    router.replace("/health"); router.refresh();
  }

  return <form className="stack" onSubmit={submit}>
    <label className="field">كلمة المرور الجديدة<input className="input" name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
    <label className="field">تأكيد كلمة المرور<input className="input" name="confirmation" type="password" autoComplete="new-password" minLength={8} required /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="button" disabled={loading}>{loading ? "جارٍ الحفظ" : "حفظ كلمة المرور"}</button>
  </form>;
}
