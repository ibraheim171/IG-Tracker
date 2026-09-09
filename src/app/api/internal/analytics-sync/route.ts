import { NextRequest, NextResponse } from "next/server";
import {
  analyticsIdempotencyHash,
  readBoundedAnalyticsBody,
  isTruthfulAcceptedIngestionResult,
  validateAnalyticsPayload,
  verifyAnalyticsIdempotencySignature,
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
}) => PromiseLike<{ data: {
  replayed?: boolean;
  run_id?: string;
  received_count?: number;
  inserted_count?: number;
  updated_count?: number;
  already_present_identical_count?: number;
  rejected_count?: number;
  row_counts?: Json;
} | null; error: unknown }>;

function safeError(code: string, status: number, counts?: { received_count: number; rejected_count: number }) {
  return NextResponse.json({
    ok: false,
    code,
    ...(counts ? {
      received_count: counts.received_count,
      inserted_count: 0,
      updated_count: 0,
      already_present_identical_count: 0,
      rejected_count: counts.rejected_count,
    } : {}),
  }, { status, headers: { "Cache-Control": "no-store" } });
}

function payloadRowCount(payload: { posts: unknown[]; post_daily: unknown[]; account_daily: unknown[]; demographics: unknown[]; collabs: unknown[] }) {
  return payload.posts.length + payload.post_daily.length + payload.account_daily.length + payload.demographics.length + payload.collabs.length;
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return safeError("E_PAYLOAD_JSON", 400);
  }
  const validated = validateAnalyticsPayload(parsed);
  if (!validated.ok) return safeError(validated.code, 400);
  const timestampHeader = request.headers.get("x-analytics-timestamp");
  const signatureHeader = request.headers.get("x-analytics-signature");
  const signedIdempotencyKey = request.headers.get("x-analytics-idempotency-key");
  const signature = signedIdempotencyKey
    ? verifyAnalyticsIdempotencySignature({
      secret,
      timestamp: timestampHeader,
      signature: signatureHeader,
      idempotencyKey: signedIdempotencyKey,
    })
    : verifyAnalyticsSignature({
      secret,
      timestamp: timestampHeader,
      signature: signatureHeader,
      rawBody: bytes,
    });
  if (!signature.ok || (signedIdempotencyKey !== null && signedIdempotencyKey !== validated.value.idempotency_key)) {
    return safeError(signature.ok ? "E_SIGNATURE_INVALID" : signature.code, 401);
  }
  const receivedCount = payloadRowCount(validated.value);

  try {
    const client = analyticsServiceClient();
    const rpc = client.rpc.bind(client) as unknown as SyncRpc;
    const timestamp = new Date(Number(request.headers.get("x-analytics-timestamp")) * 1000).toISOString();
    const { data, error } = await rpc("ingest_analytics_batch", {
      p_payload: validated.value as unknown as Json,
      p_idempotency_key: validated.value.idempotency_key,
      p_signature_timestamp: timestamp,
      p_source_timestamp: validated.value.source_timestamp,
      p_request_sha256: analyticsIdempotencyHash(validated.value),
    });
    if (error || !data) return safeError("E_SYNC_WRITE", 500, { received_count: receivedCount, rejected_count: receivedCount });
    if (!isTruthfulAcceptedIngestionResult(data, receivedCount)) return safeError("E_SYNC_WRITE", 500, { received_count: receivedCount, rejected_count: receivedCount });
    return NextResponse.json({
      ok: true,
      replayed: data.replayed === true,
      run_id: data.run_id,
      received_count: data.received_count,
      inserted_count: data.inserted_count,
      updated_count: data.updated_count,
      already_present_identical_count: data.already_present_identical_count,
      rejected_count: data.rejected_count,
      row_counts: data.row_counts,
    }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    return safeError(caught instanceof Error && caught.message === "E_SERVER_CONFIG" ? "E_SYNC_NOT_CONFIGURED" : "E_SYNC_WRITE", caught instanceof Error && caught.message === "E_SERVER_CONFIG" ? 503 : 500);
  }
}
