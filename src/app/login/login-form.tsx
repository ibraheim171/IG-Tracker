"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type LoginErrorLike = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  status?: unknown;
};

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readStatus(value: unknown) {
  return typeof value === "number" ? value : null;
}

function safeDiagnosticCode(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "unknown";
}

function loginErrorMessage(error: unknown) {
  const details = error as LoginErrorLike;
  const code = readString(details.code);
  const message = readString(details.message);
  const name = readString(details.name);
  const status = readStatus(details.status);
  const fingerprint = `${code} ${name} ${message}`.toLowerCase();

  if (code === "invalid_credentials" || fingerprint.includes("invalid login credentials")) {
    return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  }

  if (status === 429 || fingerprint.includes("rate") || fingerprint.includes("too many")) {
    return "محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.";
  }

  if (
    name === "TypeError" ||
    fingerprint.includes("failed to fetch") ||
    fingerprint.includes("network") ||
    fingerprint.includes("fetch")
  ) {
    return "تعذر الاتصال بخادم تسجيل الدخول. تحقق من الشبكة ثم حاول مجددًا.";
  }

  const diagnostic = safeDiagnosticCode(code || name);
  return `تعذر تسجيل الدخول. رمز التشخيص: ${diagnostic}.`;
}

export function LoginForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const form = new FormData(event.currentTarget);
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });

      if (signInError) {
        setError(loginErrorMessage(signInError));
        return;
      }

      router.replace("/");
      router.refresh();
    } catch (signInError) {
      setError(loginErrorMessage(signInError));
    } finally {
      setLoading(false);
    }
  }

  return <form className="stack" onSubmit={submit}>
    <label className="field">البريد الإلكتروني<input className="input" name="email" type="email" autoComplete="email" required /></label>
    <label className="field">
      <span>كلمة المرور</span>
      <span className="actions-row">
        <input
          className="input"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          style={{ flex: "1 1 12rem" }}
        />
        <button
          aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
          aria-pressed={showPassword}
          className="button button-secondary"
          type="button"
          onClick={() => setShowPassword((visible) => !visible)}
        >
          {showPassword ? "إخفاء" : "إظهار"}
        </button>
      </span>
    </label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="button" disabled={loading}>{loading ? "جارٍ الدخول" : "تسجيل الدخول"}</button>
  </form>;
}
