"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const { error: signInError } = await createClient().auth.signInWithPassword({
      email: String(form.get("email")), password: String(form.get("password")),
    });
    if (signInError) { setError("تعذر تسجيل الدخول. تحقق من البريد الإلكتروني وكلمة المرور."); setLoading(false); return; }
    router.replace("/"); router.refresh();
  }

  return <form className="stack" onSubmit={submit}>
    <label className="field">البريد الإلكتروني<input className="input" name="email" type="email" autoComplete="email" required /></label>
    <label className="field">كلمة المرور<input className="input" name="password" type="password" autoComplete="current-password" required /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="button" disabled={loading}>{loading ? "جارٍ الدخول" : "تسجيل الدخول"}</button>
  </form>;
}
