import { PasswordForm } from "@/app/account/password/password-form";

export default function PasswordPage() {
  return <main className="page auth-page"><section className="card stack"><h1>تغيير كلمة المرور</h1><p className="muted">يجب تغيير كلمة المرور المؤقتة قبل متابعة استخدام المنصة.</p><PasswordForm /></section></main>;
}
