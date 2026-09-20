export type MonthlyReportInput = { month: unknown; title: unknown; contextNote: unknown };

export function validateMonthlyReportInput(input: MonthlyReportInput) {
  const month = typeof input.month === "string" ? input.month : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const contextNote = typeof input.contextNote === "string" ? input.contextNote.trim() : "";
  if (!/^\d{4}-\d{2}-01$/.test(month) || Number.isNaN(Date.parse(`${month}T00:00:00Z`))) return { ok: false as const, code: "E_MONTH", message: "يجب اختيار شهر صحيح." };
  if (title.length < 1 || title.length > 160) return { ok: false as const, code: "E_TITLE", message: "يجب أن يكون العنوان بين 1 و160 حرفًا." };
  if (contextNote.length > 4000) return { ok: false as const, code: "E_CONTEXT", message: "يجب ألا يتجاوز السياق البشري 4000 حرف." };
  return { ok: true as const, value: { month, title, contextNote: contextNote || null } };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
