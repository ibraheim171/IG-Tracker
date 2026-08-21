"use client";

import { FormEvent, useState } from "react";
import type { Database, Tables } from "@/lib/database.types";

type Role = Database["public"]["Enums"]["role_name"];
type Profile = Tables<"profiles">;
const roles: Role[] = ["writer", "reviewer", "producer", "admin"];

export function UsersManager({ initialProfiles }: { initialProfiles: Profile[] }) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function request(method: "POST" | "PATCH", body: object) {
    const response = await fetch("/api/admin/users", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload: unknown = await response.json();
    if (!response.ok || !isResponse(payload)) throw new Error(isResponse(payload) ? payload.error : "تعذر حفظ التغييرات.");
    return payload;
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setPassword(""); setSaving(true);
    const form = new FormData(event.currentTarget);
    const selectedRoles = roles.filter((role) => form.getAll("roles").includes(role));
    try {
      const result = await request("POST", { email: String(form.get("email")), displayName: String(form.get("displayName")), roles: selectedRoles });
      const profile = result.profile;
      const temporaryPassword = result.password;
      if (!profile || !temporaryPassword) throw new Error("تعذر إنشاء المستخدم.");
      setProfiles((current) => [...current, profile]); setPassword(temporaryPassword); event.currentTarget.reset();
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "تعذر إنشاء المستخدم."); }
    finally { setSaving(false); }
  }

  async function updateProfile(profile: Profile, changes: { active?: boolean; roles?: Role[] }) {
    setError("");
    try {
      const result = await request("PATCH", { id: profile.id, ...changes });
      const updatedProfile = result.profile;
      if (!updatedProfile) throw new Error("تعذر حفظ التغييرات.");
      setProfiles((current) => current.map((item) => item.id === profile.id ? updatedProfile : item));
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "تعذر حفظ التغييرات."); }
  }

  return <div className="stack">
    <section className="card stack"><h2>إضافة مستخدم</h2><form className="stack" onSubmit={createUser}>
      <label className="field">البريد الإلكتروني<input className="input" name="email" type="email" required /></label>
      <label className="field">الاسم الظاهر<input className="input" name="displayName" required /></label>
      <fieldset><legend>الأدوار</legend><div className="checks">{roles.map((role) => <label key={role}><input name="roles" type="checkbox" value={role} defaultChecked={role === "writer"} /> <span className="num">{role}</span></label>)}</div></fieldset>
      <button className="button" disabled={saving}>{saving ? "جارٍ الإنشاء" : "إنشاء المستخدم"}</button>
    </form>{password && <div className="card stack"><strong>كلمة المرور المؤقتة</strong><span className="num">{password}</span><button className="button button-secondary" type="button" onClick={() => navigator.clipboard.writeText(password)}>نسخ كلمة المرور</button></div>}</section>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="card stack"><h2>المستخدمون</h2><div className="table-wrap"><table><thead><tr><th>الاسم</th><th>الأدوار</th><th>نشط</th><th>تعديل الأدوار</th></tr></thead><tbody>{profiles.map((profile) => <tr key={profile.id}><td>{profile.display_name}</td><td className="num">{profile.roles.join(" · ")}</td><td><button className="button button-secondary" type="button" onClick={() => updateProfile(profile, { active: !profile.active })}>{profile.active ? "نشط" : "موقوف"}</button></td><td><fieldset><div className="checks">{roles.map((role) => <label key={role}><input type="checkbox" checked={profile.roles.includes(role)} onChange={() => { const nextRoles = profile.roles.includes(role) ? profile.roles.filter((item) => item !== role) : [...profile.roles, role]; if (nextRoles.length) updateProfile(profile, { roles: nextRoles }); }} /> <span className="num">{role}</span></label>)}</div></fieldset></td></tr>)}</tbody></table></div></section>
  </div>;
}

type ApiResponse = { error?: string; password?: string; profile?: Profile };
function isResponse(value: unknown): value is ApiResponse { return typeof value === "object" && value !== null; }
