export const weeklyReportsBucket = "weekly-reports";
export const weeklyReportMaxBytes = 2 * 1024 * 1024;

export type WeeklyReportInput = {
  title: string;
  periodStart: string;
  periodEnd: string;
  filename: string;
};

export type WeeklyReportValidation =
  | { ok: true; value: WeeklyReportInput }
  | { ok: false; message: string; code: string };

export function validateWeeklyReportInput(input: WeeklyReportInput): WeeklyReportValidation {
  const value = {
    title: input.title.trim().replace(/\s+/g, " "),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    filename: input.filename.trim(),
  };
  if (!value.title || value.title.length > 160) {
    return { ok: false, message: "عنوان التقرير مطلوب ويجب ألا يتجاوز 160 حرفًا.", code: "E_TITLE" };
  }
  if (!isIsoDate(value.periodStart) || !isIsoDate(value.periodEnd) || value.periodStart > value.periodEnd) {
    return { ok: false, message: "فترة التقرير غير صحيحة.", code: "E_PERIOD" };
  }
  if (!/^[^\\/\u0000-\u001f\u007f]+\.html?$/i.test(value.filename) || value.filename.length > 255) {
    return { ok: false, message: "يجب اختيار ملف HTML أو HTM واحد.", code: "E_EXTENSION" };
  }
  return { ok: true, value };
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function canManageWeeklyReports(profile: { active: boolean; roles: string[] } | null) {
  return Boolean(profile?.active && profile.roles.includes("admin"));
}

export function isSameOriginAppRequest(input: {
  appOrigin: string;
  origin?: string | null;
  referer?: string | null;
  fetchSite?: string | null;
}) {
  if (input.origin) return safeOrigin(input.origin) === input.appOrigin;
  if (input.referer) return safeOrigin(input.referer) === input.appOrigin;
  return input.fetchSite === "same-origin";
}

function safeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes = weeklyReportMaxBytes,
): Promise<Uint8Array> {
  if (!stream) throw new Error("E_EMPTY_FILE");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("E_FILE_TOO_LARGE");
        throw new Error("E_FILE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error("E_EMPTY_FILE");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const forbiddenTag = /<\s*\/?\s*(?:script|iframe|frame|frameset|object|embed|base|form|meta|link|a|img|picture|source|video|audio|track|svg|math)(?:\s|\/?>)/i;
const forbiddenAttribute = /\s(?:on[a-z0-9_-]+|srcdoc)\s*=/i;
const javascriptUrl = /(?:href|src|action|formaction|poster|background)\s*=\s*(?:["']\s*javascript:|javascript:)/i;
const remoteUrlAttribute = /(?:href|src|action|formaction|poster|background)\s*=\s*["']\s*(?:https?:)?\/\//i;
const cssImport = /@import\b/i;
const remoteCssUrl = /url\s*\(\s*["']?\s*(?!(?:data:image\/|#))/i;

export function validateSafeHtml(html: string) {
  if (
    forbiddenTag.test(html)
    || forbiddenAttribute.test(html)
    || javascriptUrl.test(html)
    || remoteUrlAttribute.test(html)
    || cssImport.test(html)
    || remoteCssUrl.test(html)
  ) {
    return { ok: false as const, message: "يحتوي ملف HTML على عناصر أو روابط غير مسموح بها.", code: "E_DANGEROUS_HTML" };
  }
  return { ok: true as const };
}

export async function sha256Hex(bytes: Uint8Array) {
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function immutableWeeklyReportPath(reportId: string, sha256: string, token = crypto.randomUUID()) {
  return `${reportId}/${token}-${sha256.slice(0, 16)}.html`;
}

export function publicWeeklyReport<T extends { storage_path: string; uploaded_by: string }>(report: T): Omit<T, "storage_path" | "uploaded_by"> {
  const copy = { ...report };
  delete (copy as Partial<T>).storage_path;
  delete (copy as Partial<T>).uploaded_by;
  return copy;
}

export const weeklyReportPreviewHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; navigate-to 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export function weeklyReportDownloadHeaders(filename: string) {
  const safeAscii = filename.replace(/[^A-Za-z0-9._-]/g, "_") || "report.html";
  const encodedFilename = encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Disposition": `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodedFilename}`,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Type": "application/octet-stream",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  } as const;
}
