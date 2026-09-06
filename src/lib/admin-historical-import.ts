import type { Json } from "./database.types.ts";

export const HISTORICAL_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const HISTORICAL_IMPORT_MAX_ROWS = 200;
export const HISTORICAL_IMPORT_CONFIRMATION = "استيراد السجل التاريخي";
export const HISTORICAL_IMPORT_CUTOFF = "2026-09-06T09:30:57+03:00";

const requiredHeaders = ["title", "permalink", "published_at"] as const;
const optionalHeaders = ["track", "idea_type", "partners", "caption", "notes"] as const;
const allowedHeaders = new Set<string>([...requiredHeaders, ...optionalHeaders]);

export type HistoricalImportRow = {
  csv_line: number;
  title: string;
  permalink: string;
  published_at: string;
  track?: string | null;
  idea_type?: string | null;
  partners?: string[];
  caption?: string | null;
  notes?: string | null;
};

export type HistoricalImportPreviewRow = {
  csv_line: number | null;
  valid: boolean;
  errors: string[];
  resolved: {
    title: string | null;
    permalink: string | null;
    published_at: string | null;
    track: string | null;
    idea_type: string | null;
    partners: string[];
  };
};

export type HistoricalImportPreview = {
  ok: boolean;
  dry_run: true;
  preview_token: string;
  preview_expires_at: string;
  source_filename: string;
  source_sha256: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  intended_items: number;
  intended_new_slots: number;
  rows: HistoricalImportPreviewRow[];
};

export type HistoricalImportApplyResult = {
  ok: true;
  dry_run: false;
  batch_id: string;
  source_filename: string;
  source_sha256: string;
  inserted_items: number;
  created_slots: number;
  reused_slots: number;
  inserted_transitions: number;
  items: { id: string; ref: string; csv_line: number }[];
};

export type CsvParseResult =
  | { ok: true; rows: HistoricalImportRow[] }
  | { ok: false; errors: string[] };

function parseCsvRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let afterClosingQuote = false;

  function finishRecord() {
    record.push(field);
    records.push(record);
    record = [];
    field = "";
    afterClosingQuote = false;
  }

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        afterClosingQuote = true;
      } else {
        field += character;
      }
      continue;
    }

    if (afterClosingQuote) {
      if (character === ",") {
        record.push(field);
        field = "";
        afterClosingQuote = false;
      } else if (character === "\n") {
        finishRecord();
      } else if (character === "\r") {
        finishRecord();
        if (input[index + 1] === "\n") index += 1;
      } else {
        throw new Error("INVALID_QUOTE_SUFFIX");
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) throw new Error("INVALID_QUOTE");
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      finishRecord();
    } else if (character === "\r") {
      finishRecord();
      if (input[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("UNCLOSED_QUOTE");
  record.push(field);
  if (record.length > 1 || record[0] !== "" || records.length === 0) records.push(record);
  return records;
}

function optionalCell(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function parseHistoricalCsv(input: string): CsvParseResult {
  let records: string[][];
  try {
    records = parseCsvRecords(input.replace(/^\uFEFF/, ""));
  } catch (error) {
    const message = error instanceof Error && error.message === "UNCLOSED_QUOTE"
      ? "يوجد حقل مقتبس لم يُغلق في ملف CSV."
      : "صيغة علامات الاقتباس في ملف CSV غير صحيحة.";
    return { ok: false, errors: [message] };
  }

  if (records.length < 2) return { ok: false, errors: ["يجب أن يحتوي الملف على صف بيانات واحد على الأقل."] };

  const headers = records[0].map((value) => value.trim());
  const errors: string[] = [];
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length > 0) errors.push("توجد أعمدة مكررة في رأس الملف.");
  const unknownHeaders = headers.filter((header) => !allowedHeaders.has(header));
  if (unknownHeaders.length > 0) errors.push(`أعمدة غير مسموحة: ${unknownHeaders.join("، ")}`);
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) errors.push(`أعمدة مطلوبة مفقودة: ${missingHeaders.join("، ")}`);
  if (errors.length > 0) return { ok: false, errors };

  const rows: HistoricalImportRow[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const cells = records[index];
    if (cells.every((value) => value.trim() === "")) continue;
    if (cells.length !== headers.length) {
      errors.push(`السطر ${(index + 1).toLocaleString("en-US")} لا يطابق عدد الأعمدة.`);
      continue;
    }
    const values = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]]));
    const partners = optionalCell(values.partners)
      ?.split("|")
      .map((partner) => partner.trim())
      .filter(Boolean) ?? [];
    rows.push({
      csv_line: index + 1,
      title: values.title ?? "",
      permalink: values.permalink ?? "",
      published_at: values.published_at ?? "",
      ...(headers.includes("track") ? { track: optionalCell(values.track) } : {}),
      ...(headers.includes("idea_type") ? { idea_type: optionalCell(values.idea_type) } : {}),
      ...(headers.includes("partners") ? { partners } : {}),
      ...(headers.includes("caption") ? { caption: optionalCell(values.caption) } : {}),
      ...(headers.includes("notes") ? { notes: optionalCell(values.notes) } : {}),
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  if (rows.length < 1 || rows.length > HISTORICAL_IMPORT_MAX_ROWS) {
    return { ok: false, errors: [`يجب أن يحتوي الملف على 1 إلى ${HISTORICAL_IMPORT_MAX_ROWS.toLocaleString("en-US")} صف.`] };
  }
  return { ok: true, rows };
}

export function historicalRowsToJson(rows: HistoricalImportRow[]) {
  return rows as unknown as Json;
}

export function safeHistoricalImportError(message: string | undefined) {
  if (!message) return "تعذر فحص ملف الاستيراد. رمز التشخيص: HISTORICAL_IMPORT_RPC.";
  const markers = [
    "ROLE_REQUIRED:", "INVALID_PAYLOAD:", "ROW_LIMIT:", "PAYLOAD_TOO_LARGE:",
    "INVALID_SOURCE_FILENAME:", "INVALID_SOURCE_SHA256:", "REASON_REQUIRED:",
    "PREVIEW_REQUIRED:", "PREVIEW_ACTOR_MISMATCH:", "PREVIEW_INPUT_MISMATCH:",
    "PREVIEW_ALREADY_USED:", "PREVIEW_EXPIRED:", "IMPORT_CLOSED:", "VALIDATION_FAILED:",
  ];
  for (const marker of markers) {
    const index = message.indexOf(marker);
    if (index >= 0) return message.slice(index + marker.length).trim();
  }
  return "تعذر فحص ملف الاستيراد. رمز التشخيص: HISTORICAL_IMPORT_RPC.";
}
