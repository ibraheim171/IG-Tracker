"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  compatibleOperationalParts,
  operationalPartLabels,
  operationalPartsForRoles,
  toReassignTasksResult,
  type OperationalPart,
  type ReassignTasksResult,
} from "@/lib/admin-reassign-tasks";
import { createEmptyUserDraft, type PasswordMode } from "@/lib/admin-users-form";
import { type AdminUser, allowedRoles, roleLabels, type Role } from "@/lib/admin-users";
import type { Json } from "@/lib/database.types";
import { statusLabels } from "@/lib/ui-data";

type ApiResponse = { error?: string; code?: string; user?: AdminUser; users?: AdminUser[]; temporaryPassword?: string; deleted?: boolean; id?: string; auditPending?: boolean; authDeleted?: boolean; profileCleanupPending?: boolean; references?: { label: string; count: number }[] };
type EditingState = { user: AdminUser; displayName: string; email: string; roles: Role[]; active: boolean; reason: string };
type PasswordState = { user: AdminUser; passwordMode: PasswordMode; temporaryPassword: string };
type DeleteState = { user: AdminUser; reason: string; references?: { label: string; count: number }[] };
type ReassignState = { source: AdminUser; targetId: string; parts: OperationalPart[]; reason: string; preview: ReassignTasksResult | null; previewDirty: boolean };
type ConfirmState = { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> };

export function UsersManager({ initialUsers, initialError = "" }: { initialUsers: AdminUser[]; initialError?: string }) {
  const [users, setUsers] = useState(initialUsers);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [listError, setListError] = useState(initialError);
  const [saving, setSaving] = useState(false);
  const [createDraft, setCreateDraft] = useState(createEmptyUserDraft);
  const [oneTimePassword, setOneTimePassword] = useState<{ email: string; password: string } | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [resetting, setResetting] = useState<PasswordState | null>(null);
  const [deleting, setDeleting] = useState<DeleteState | null>(null);
  const [reassigning, setReassigning] = useState<ReassignState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => user.display_name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle));
  }, [query, users]);

  async function request(method: "GET" | "POST" | "PATCH" | "DELETE", body?: object) {
    const response = await fetch("/api/admin/users", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload: unknown = await response.json();
    if (!response.ok || !isResponse(payload)) throw new Error(isResponse(payload) ? `${payload.error} [${payload.code ?? "E_REQUEST"}]` : "تعذر حفظ التغييرات. [E_REQUEST]");
    return payload;
  }

  async function requestReassign(body: ReassignState, dryRun: boolean) {
    const response = await fetch("/api/admin/reassign-tasks", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUserId: body.source.id,
        targetUserId: body.targetId,
        parts: body.parts,
        reason: body.reason,
        dryRun,
      }),
    });
    const payload: unknown = await response.json();
    const result = toReassignTasksResult(payload as Json);
    if (!response.ok || !result?.ok) {
      const error = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "تعذر نقل المهام.";
      const code = typeof payload === "object" && payload !== null && "code" in payload && typeof payload.code === "string"
        ? payload.code
        : "E_REASSIGN";
      throw new Error(`${error} [${code}]`);
    }
    return result;
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(""); setOneTimePassword(null); setSaving(true);
    try {
      const result = await request("POST", {
        email: createDraft.email,
        displayName: createDraft.displayName,
        roles: createDraft.roles,
        passwordMode: createDraft.passwordMode,
        temporaryPassword: createDraft.temporaryPassword,
      });
      if (!result.user || !result.temporaryPassword) throw new Error("تعذر إنشاء المستخدم. [E_CREATE]");
      setUsers((current) => sortUsers([...current, result.user!]));
      setOneTimePassword({ email: result.user.email, password: result.temporaryPassword });
      setCreateDraft(createEmptyUserDraft());
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : "تعذر إنشاء المستخدم."); }
    finally { setSaving(false); }
  }

  async function refreshUsers() {
    setListError("");
    try {
      const result = await request("GET");
      if (!result.users) throw new Error("تعذر تحميل القائمة. [E_USERS_LOAD]");
      setUsers(result.users);
    } catch (caught) { setListError(caught instanceof Error ? caught.message : "تعذر تحميل القائمة."); }
  }

  async function saveEdit() {
    if (!editing || saving) return;
    setError(""); setSaving(true);
    try {
      const result = await request("PATCH", {
        id: editing.user.id,
        displayName: editing.displayName,
        email: editing.email,
        previousEmail: editing.user.email,
        roles: editing.roles,
        active: editing.active,
        reason: editing.reason,
      });
      if (!result.user) throw new Error("تعذر حفظ التغييرات. [E_UPDATE]");
      setUsers((current) => sortUsers(current.map((user) => user.id === result.user!.id ? result.user! : user)));
      setEditing(null); setConfirm(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "تعذر حفظ التغييرات."); }
    finally { setSaving(false); }
  }

  async function savePasswordReset() {
    if (!resetting || saving) return;
    setError(""); setOneTimePassword(null); setSaving(true);
    try {
      const result = await request("PATCH", {
        action: "resetPassword",
        id: resetting.user.id,
        passwordMode: resetting.passwordMode,
        temporaryPassword: resetting.temporaryPassword,
      });
      if (!result.user || !result.temporaryPassword) throw new Error("تعذر إعادة ضبط كلمة المرور. [E_PASSWORD_RESET]");
      setUsers((current) => current.map((user) => user.id === result.user!.id ? result.user! : user));
      setOneTimePassword({ email: result.user.email, password: result.temporaryPassword });
      if (result.auditPending) setError("تم تغيير كلمة المرور، لكن سجل التدقيق ما زال قيد المتابعة. لا تعِد العملية لنفس الحساب. [E_AUDIT_PENDING]");
      setResetting(null); setConfirm(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "تعذر إعادة ضبط كلمة المرور."); }
    finally { setSaving(false); }
  }

  async function deleteUser() {
    if (!deleting || saving) return;
    setError(""); setSaving(true);
    try {
      const result = await request("DELETE", { id: deleting.user.id, reason: deleting.reason });
      if (result.references?.length) {
        setDeleting({ ...deleting, references: result.references });
        throw new Error("لا يمكن حذف حساب له سجل تاريخي. عطّله بدلًا من ذلك. [E_HAS_HISTORY]");
      }
      if (result.authDeleted && result.profileCleanupPending) {
        setError("تم حذف حساب Auth، لكن تنظيف profile لم يكتمل. لا تعِد العملية قبل مراجعة السجل. [E_PROFILE_DELETE]");
        return;
      }
      if (!result.deleted) throw new Error("تعذر حذف المستخدم. [E_DELETE]");
      setUsers((current) => current.filter((user) => user.id !== deleting.user.id));
      if (result.auditPending) setError("تم حذف الحساب، لكن سجل التدقيق ما زال قيد المتابعة. [E_AUDIT_PENDING]");
      setDeleting(null); setConfirm(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "تعذر حذف المستخدم."); }
    finally { setSaving(false); }
  }

  function openReassign(source: AdminUser) {
    const target = users.find((user) => user.id !== source.id && user.active) ?? null;
    const initialParts = target ? compatibleOperationalParts(source.roles, target.roles) : operationalPartsForRoles(source.roles);
    setError("");
    setReassigning({ source, targetId: target?.id ?? "", parts: initialParts, reason: "", preview: null, previewDirty: true });
  }

  async function previewReassign() {
    if (!reassigning || saving) return;
    setError(""); setSaving(true);
    try {
      const preview = await requestReassign(reassigning, true);
      setReassigning((current) => current ? { ...current, preview, previewDirty: false } : current);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "تعذر تجهيز المعاينة."); }
    finally { setSaving(false); }
  }

  async function executeReassign() {
    if (!reassigning || saving || reassigning.previewDirty || !reassigning.preview) return;
    setError(""); setSaving(true);
    try {
      const result = await requestReassign(reassigning, false);
      setError(`تم نقل ${formatCount(result.removed_assignments ?? result.total_items ?? 0)}. رقم العملية: ${result.action_id ?? "—"}`);
      setReassigning(null); setConfirm(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "تعذر تنفيذ النقل."); }
    finally { setSaving(false); }
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const changedEmail = editing.email.trim().toLowerCase() !== editing.user.email.toLowerCase();
    const changedRoles = JSON.stringify(editing.roles) !== JSON.stringify(editing.user.roles);
    const changedActive = editing.active !== editing.user.active;
    if (changedEmail || changedRoles || changedActive) {
      setConfirm({
        title: changedEmail ? "تأكيد تغيير البريد" : changedRoles ? "تأكيد تغيير الصلاحيات" : editing.active ? "تأكيد إعادة التفعيل" : "تأكيد التعطيل",
        body: changedEmail ? "سيتم تغيير بريد Auth من مسار خادمي موثوق." : changedRoles ? "سيتم حفظ الصلاحيات الجديدة بعد تحقق السيرفر." : "سيتم تحديث حالة الحساب في Auth وprofile.",
        confirmLabel: "تأكيد",
        danger: !editing.active,
        onConfirm: saveEdit,
      });
    } else {
      void saveEdit();
    }
  }

  return <div className="stack">
    <section className="card stack">
      <h2>إضافة مستخدم</h2>
      <form className="stack" onSubmit={createUser}>
        <div className="form-grid">
          <label className="field">الاسم الظاهر<input className="input" name="displayName" value={createDraft.displayName} onChange={(event) => setCreateDraft((draft) => ({ ...draft, displayName: event.target.value }))} required /></label>
          <label className="field">البريد الإلكتروني<input className="input" name="email" type="email" value={createDraft.email} onChange={(event) => setCreateDraft((draft) => ({ ...draft, email: event.target.value }))} required /></label>
        </div>
        <RoleChecks selected={createDraft.roles} onChange={(roles) => setCreateDraft((draft) => ({ ...draft, roles }))} />
        <SegmentedPasswordMode value={createDraft.passwordMode} onChange={(passwordMode) => setCreateDraft((draft) => ({ ...draft, passwordMode, temporaryPassword: passwordMode === "generated" ? "" : draft.temporaryPassword }))} />
        {createDraft.passwordMode === "manual" && <label className="field">كلمة مرور مؤقتة<input className="input num" name="temporaryPassword" type="password" autoComplete="new-password" minLength={12} value={createDraft.temporaryPassword} onChange={(event) => setCreateDraft((draft) => ({ ...draft, temporaryPassword: event.target.value }))} required /></label>}
        <button className="button" disabled={saving}>{saving ? "جارٍ الحفظ" : "إنشاء الحساب"}</button>
      </form>
      {oneTimePassword && <OneTimePasswordBox email={oneTimePassword.email} password={oneTimePassword.password} onDismiss={() => setOneTimePassword(null)} />}
    </section>

    {error && <p className="error" role="alert">{error}</p>}

    <section className="card stack">
      <div className="users-toolbar">
        <h2>الحسابات</h2>
        <button className="button button-secondary" type="button" onClick={refreshUsers} disabled={saving}>تحديث</button>
      </div>
      <label className="field">بحث<input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="الاسم أو البريد" /></label>
      {listError && <p className="error" role="alert">{listError}</p>}
      {!listError && filteredUsers.length === 0 && <p className="notice">لا توجد حسابات مطابقة.</p>}
      {filteredUsers.length > 0 && <div className="table-wrap"><table className="users-table"><thead><tr><th>الاسم</th><th>البريد</th><th>الأدوار</th><th>الحالة</th><th>تاريخ الإنشاء</th><th>آخر دخول</th><th>إجراءات</th></tr></thead><tbody>{filteredUsers.map((user) => <tr key={user.id}><td className="user-name-cell">{user.display_name}</td><td className="email-cell num">{user.email || "—"}</td><td className="roles-cell">{formatRoles(user.roles)}</td><td><span className={user.active ? "status-pill is-active" : "status-pill"}>{user.active ? "نشط" : "معطّل"}</span></td><DateCell value={user.created_at} /><DateCell value={user.last_sign_in_at} /><td className="actions-cell"><div className="user-actions"><button className="button button-secondary" type="button" disabled={saving} onClick={() => setEditing({ user, displayName: user.display_name, email: user.email, roles: user.roles, active: user.active, reason: "" })}>تعديل</button><button className="button button-secondary" type="button" disabled={saving} onClick={() => openReassign(user)}>نقل المهام</button><button className="button button-secondary" type="button" disabled={saving} onClick={() => setResetting({ user, passwordMode: "generated", temporaryPassword: "" })}>كلمة المرور</button><button className="button button-danger" type="button" disabled={saving} onClick={() => setDeleting({ user, reason: "" })}>حذف</button></div></td></tr>)}</tbody></table></div>}
    </section>

    {editing && <Modal title="تعديل الحساب" onClose={() => setEditing(null)}>
      <form className="stack" onSubmit={submitEdit}>
        <label className="field">الاسم الظاهر<input className="input" value={editing.displayName} onChange={(event) => setEditing({ ...editing, displayName: event.target.value })} required /></label>
        <label className="field">البريد الإلكتروني<input className="input" type="email" value={editing.email} onChange={(event) => setEditing({ ...editing, email: event.target.value })} required /></label>
        <RoleChecks selected={editing.roles} onChange={(roles) => setEditing({ ...editing, roles })} />
        <label className="toggle-row"><input type="checkbox" checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} /> <span>{editing.active ? "الحساب نشط" : "الحساب معطّل"}</span></label>
        {!editing.active && <p className="muted">إذا بقيت للعضو مهام حالية، استخدم زر نقل المهام في جدول الحسابات قبل أو بعد التعطيل.</p>}
        {!editing.active && <label className="field">سبب التعطيل<input className="input" value={editing.reason} onChange={(event) => setEditing({ ...editing, reason: event.target.value })} /></label>}
        <button className="button" disabled={saving}>{saving ? "جارٍ الحفظ" : "حفظ"}</button>
      </form>
    </Modal>}

    {reassigning && <ReassignTasksModal
      state={reassigning}
      users={users}
      saving={saving}
      onChange={setReassigning}
      onPreview={previewReassign}
      onClose={() => setReassigning(null)}
      onConfirm={() => {
        const target = users.find((user) => user.id === reassigning.targetId);
        setConfirm({
          title: "تأكيد نقل المهام",
          body: `سيتم نقل ${formatCount(reassigning.preview?.total_items ?? 0)} من ${reassigning.source.display_name} إلى ${target?.display_name ?? "العضو المستهدف"}.`,
          confirmLabel: "نقل المهام",
          onConfirm: executeReassign,
        });
      }}
    />}

    {resetting && <Modal title="إعادة ضبط كلمة المرور" onClose={() => setResetting(null)}>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); setConfirm({ title: "تأكيد إعادة الضبط", body: "ستظهر كلمة المرور الجديدة مرة واحدة فقط بعد نجاح العملية.", confirmLabel: "إعادة الضبط", onConfirm: savePasswordReset }); }}>
        <p className="muted">{resetting.user.display_name}</p>
        <SegmentedPasswordMode value={resetting.passwordMode} onChange={(mode) => setResetting({ ...resetting, passwordMode: mode })} />
        {resetting.passwordMode === "manual" && <label className="field">كلمة مرور مؤقتة جديدة<input className="input num" type="password" minLength={12} value={resetting.temporaryPassword} onChange={(event) => setResetting({ ...resetting, temporaryPassword: event.target.value })} required /></label>}
        <button className="button" disabled={saving}>متابعة</button>
      </form>
    </Modal>}

    {deleting && <Modal title="حذف الحساب" onClose={() => setDeleting(null)}>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); setConfirm({ title: "تأكيد الحذف", body: "سيتم رفض الحذف إذا وُجد أي سجل تاريخي مرتبط بالحساب.", confirmLabel: "حذف", danger: true, onConfirm: deleteUser }); }}>
        <p className="muted">{deleting.user.display_name}</p>
        <label className="field">سبب الحذف<input className="input" value={deleting.reason} onChange={(event) => setDeleting({ ...deleting, reason: event.target.value })} required minLength={4} /></label>
        {deleting.references && <div className="notice"><strong>مراجع موجودة</strong><ul>{deleting.references.map((reference) => <li key={reference.label}>{reference.label}: <span className="num">{reference.count}</span></li>)}</ul></div>}
        <button className="button button-danger" disabled={saving}>متابعة</button>
      </form>
    </Modal>}

    {confirm && <Modal title={confirm.title} onClose={() => setConfirm(null)}>
      <div className="stack">
        <p>{confirm.body}</p>
        <div className="actions-row"><button className={confirm.danger ? "button button-danger" : "button"} type="button" onClick={() => void confirm.onConfirm()} disabled={saving}>{saving ? "جارٍ التنفيذ" : confirm.confirmLabel}</button><button className="button button-secondary" type="button" onClick={() => setConfirm(null)} disabled={saving}>إلغاء</button></div>
      </div>
    </Modal>}
  </div>;
}

function isResponse(value: unknown): value is ApiResponse { return typeof value === "object" && value !== null; }

function ReassignTasksModal({
  state,
  users,
  saving,
  onChange,
  onPreview,
  onConfirm,
  onClose,
}: {
  state: ReassignState;
  users: AdminUser[];
  saving: boolean;
  onChange: (state: ReassignState) => void;
  onPreview: () => Promise<void>;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const target = users.find((user) => user.id === state.targetId) ?? null;
  const targetOptions = users.filter((user) => user.id !== state.source.id && user.active);
  const sourceParts = operationalPartsForRoles(state.source.roles);
  const compatibleParts = target ? compatibleOperationalParts(state.source.roles, target.roles) : [];
  const unavailableParts = sourceParts.filter((part) => !compatibleParts.includes(part));
  const reasonLength = state.reason.trim().length;
  const canPreview = Boolean(target) && state.parts.length > 0;
  const canExecute = canPreview && !state.previewDirty && Boolean(state.preview) && (state.preview?.total_items ?? 0) > 0 && reasonLength >= 5 && reasonLength <= 500;

  function updateTarget(targetId: string) {
    const nextTarget = users.find((user) => user.id === targetId) ?? null;
    const nextCompatible = nextTarget ? compatibleOperationalParts(state.source.roles, nextTarget.roles) : [];
    onChange({ ...state, targetId, parts: state.parts.filter((part) => nextCompatible.includes(part)), preview: null, previewDirty: true });
  }

  function togglePart(part: OperationalPart) {
    const nextParts = state.parts.includes(part) ? state.parts.filter((item) => item !== part) : [...state.parts, part];
    onChange({ ...state, parts: sourceParts.filter((item) => nextParts.includes(item)), preview: null, previewDirty: true });
  }

  return <Modal title="نقل المهام" onClose={onClose}>
    <form className="stack" onSubmit={(event) => { event.preventDefault(); if (canExecute) onConfirm(); }}>
      <div className="reassign-grid">
        <div className="read-box"><span className="meta-label">العضو المصدر</span><strong>{state.source.display_name}</strong><span className="muted">{formatRoles(state.source.roles)}</span></div>
        <label className="field">العضو المستهدف<select className="input" value={state.targetId} onChange={(event) => updateTarget(event.target.value)} required><option value="">اختر عضواً نشطاً</option>{targetOptions.map((user) => <option key={user.id} value={user.id}>{user.display_name}، {formatRoles(user.roles)}</option>)}</select></label>
      </div>

      <fieldset>
        <legend>الأدوار المنقولة</legend>
        {sourceParts.length === 0 && <p className="muted">لا يحمل العضو المصدر أدواراً تشغيلية قابلة للنقل.</p>}
        {sourceParts.length > 0 && <div className="checks">{sourceParts.map((part) => {
          const disabled = !compatibleParts.includes(part);
          return <label key={part} className="toggle-row"><input type="checkbox" checked={state.parts.includes(part)} disabled={disabled || saving} onChange={() => togglePart(part)} /> <span>{operationalPartLabels[part]}</span></label>;
        })}</div>}
        {unavailableParts.length > 0 && <p className="muted">الأدوار غير المتاحة للمستهدف لن تُنقل: {unavailableParts.map((part) => operationalPartLabels[part]).join(" · ")}</p>}
      </fieldset>

      <div className="actions-row">
        <button className="button button-secondary" type="button" disabled={saving || !canPreview} onClick={() => void onPreview()}>{saving ? "جارٍ المعاينة" : "معاينة"}</button>
        {state.previewDirty && <span className="muted">المعاينة مطلوبة قبل التنفيذ.</span>}
      </div>

      {state.preview && <ReassignPreview preview={state.preview} />}

      <label className="field">سبب النقل<textarea className="input textarea" minLength={5} maxLength={500} value={state.reason} onChange={(event) => onChange({ ...state, reason: event.target.value })} required /></label>
      <p className="muted"><span className="num">{reasonLength.toLocaleString("en-US")}</span> / <span className="num">500</span></p>

      <div className="actions-row">
        <button className="button" type="submit" disabled={saving || !canExecute}>{saving ? "جارٍ التنفيذ" : "متابعة التنفيذ"}</button>
        <button className="button button-secondary" type="button" disabled={saving} onClick={onClose}>إلغاء</button>
      </div>
    </form>
  </Modal>;
}

function ReassignPreview({ preview }: { preview: ReassignTasksResult }) {
  const rows = preview.summary ?? [];
  return <div className="notice stack" role="status">
    <strong>معاينة النقل</strong>
    <div className="reassign-counts">
      <span>المهام القابلة للنقل: <b className="num">{(preview.total_items ?? 0).toLocaleString("en-US")}</b></span>
      <span>موجودة مسبقاً عند المستهدف: <b className="num">{(preview.duplicate_items ?? 0).toLocaleString("en-US")}</b></span>
    </div>
    {rows.length > 0 ? <table className="preview-table"><thead><tr><th>الدور</th><th>المرحلة</th><th>العدد</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.part}-${row.status}`}><td>{operationalPartLabels[row.part]}</td><td>{statusLabels[row.status]}</td><td className="num">{row.n_items.toLocaleString("en-US")}</td></tr>)}</tbody></table> : <p className="muted">لا توجد مهام حالية مطابقة للاختيار.</p>}
  </div>;
}

function sortUsers(users: AdminUser[]) {
  return [...users].sort((a, b) => a.display_name.localeCompare(b.display_name, "ar"));
}

function formatRoles(roles: Role[]) {
  return roles.map((role) => roleLabels[role]).join(" · ");
}

function DateCell({ value }: { value: string | null }) {
  if (!value) return <td className="date-cell num">—</td>;
  return <td className="date-cell num"><time dateTime={value}><span>{formatDatePart(value)}</span><span>{formatTimePart(value)}</span></time></td>;
}

function formatDatePart(value: string) {
  return new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatTimePart(value: string) {
  return new Date(value).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatCount(value: number) {
  return `${value.toLocaleString("en-US")} ${value === 1 ? "مهمة" : "مهام"}`;
}

function RoleChecks({ selected, onChange, name }: { selected: Role[]; onChange?: (roles: Role[]) => void; name?: string }) {
  return <fieldset><legend>الأدوار</legend><div className="checks">{allowedRoles.map((role) => <label key={role} className="toggle-row"><input name={name} type="checkbox" value={role} checked={onChange ? selected.includes(role) : undefined} defaultChecked={onChange ? undefined : selected.includes(role)} onChange={() => { if (!onChange) return; const next = selected.includes(role) ? selected.filter((item) => item !== role) : [...selected, role]; if (next.length > 0) onChange(allowedRoles.filter((item) => next.includes(item))); }} /> <span>{roleLabels[role]}</span></label>)}</div></fieldset>;
}

function SegmentedPasswordMode({ value, onChange }: { value: PasswordMode; onChange: (value: PasswordMode) => void }) {
  return <div className="segmented" role="group" aria-label="طريقة كلمة المرور"><button className={value === "generated" ? "is-active" : ""} type="button" onClick={() => onChange("generated")}>توليد تلقائي</button><button className={value === "manual" ? "is-active" : ""} type="button" onClick={() => onChange("manual")}>كتابة يدوية</button></div>;
}

function OneTimePasswordBox({ email, password, onDismiss }: { email: string; password: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return <div className="notice stack" role="status"><strong>كلمة المرور المؤقتة</strong><span className="num">{email}</span><span className="one-time-password num">{password}</span><div className="actions-row"><button className="button button-secondary" type="button" onClick={async () => { await navigator.clipboard.writeText(password); setCopied(true); }}>{copied ? "تم النسخ" : "نسخ"}</button><button className="button button-secondary" type="button" onClick={onDismiss}>إخفاء</button></div></div>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panelRef.current?.querySelector<HTMLElement>("input, button, textarea, select, a[href]");
    first?.focus();
    function keydown(event: KeyboardEvent) { if (event.key === "Escape") onCloseRef.current(); }
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); returnFocusRef.current?.focus(); };
  }, []);
  return <div className="veil" role="presentation"><div className="confirm-panel stack" ref={panelRef} role="dialog" aria-modal="true" aria-label={title}><div className="users-toolbar"><h2>{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label="إغلاق">×</button></div>{children}</div></div>;
}
