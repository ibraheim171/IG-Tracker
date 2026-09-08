import { NextRequest, NextResponse } from "next/server";
import {
  readBoundedAnalyticsBody,
  validateAnalyticsPayload,
  verifyAnalyticsSignature,
} from "@/lib/analytics-core";
import { analyticsServiceClient } from "@/lib/analytics-server";
import type { Json } from "@/lib/database.types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SyncRpc = (name: "ingest_analytics_batch", args: {
  p_payload: Json;
  p_idempotency_key: string;
  p_signature_timestamp: string;
  p_source_timestamp: string;
  p_request_sha256: string;
}) => PromiseLike<{ data: { replayed?: boolean; run_id?: string; accepted?: number } | null; error: unknown }>;

function safeError(code: string, status: number) {
  return NextResponse.json({ ok: false, code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const secret = process.env.ANALYTICS_SYNC_SECRET;
  if (!secret || secret.length < 32) return safeError("E_SYNC_NOT_CONFIGURED", 503);

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedAnalyticsBody(request.body);
  } catch (caught) {
    return safeError(caught instanceof Error && caught.message === "E_PAYLOAD_TOO_LARGE" ? "E_PAYLOAD_TOO_LARGE" : "E_PAYLOAD_EMPTY", caught instanceof Error && caught.message === "E_PAYLOAD_TOO_LARGE" ? 413 : 400);
  }

  const signature = verifyAnalyticsSignature({
    secret,
    timestamp: request.headers.get("x-analytics-timestamp"),
    signature: request.headers.get("x-analytics-signature"),
    rawBody: bytes,
  });
  if (!signature.ok) return safeError(signature.code, 401);

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return safeError("E_PAYLOAD_JSON", 400);
  }
  const validated = validateAnalyticsPayload(parsed);
  if (!validated.ok) return safeError(validated.code, 400);

  try {
    const client = analyticsServiceClient();
    const rpc = client.rpc.bind(client) as unknown as SyncRpc;
    const timestamp = new Date(Number(request.headers.get("x-analytics-timestamp")) * 1000).toISOString();
    const { data, error } = await rpc("ingest_analytics_batch", {
      p_payload: validated.value as unknown as Json,
      p_idempotency_key: validated.value.idempotency_key,
      p_signature_timestamp: timestamp,
      p_source_timestamp: validated.value.source_timestamp,
      p_request_sha256: signature.requestSha256,
    });
    if (error || !data) return safeError("E_SYNC_WRITE", 500);
    if (data.replayed) return safeError("E_REPLAY", 409);
    return NextResponse.json({ ok: true, run_id: data.run_id, accepted: data.accepted }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    return safeError(caught instanceof Error && caught.message === "E_SERVER_CONFIG" ? "E_SYNC_NOT_CONFIGURED" : "E_SYNC_WRITE", caught instanceof Error && caught.message === "E_SERVER_CONFIG" ? 503 : 500);
  }
}
