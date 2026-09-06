export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("REQUEST_BODY_TOO_LARGE");
    this.name = "RequestBodyTooLargeError";
  }
}

export function declaredBodyExceedsLimit(value: string | null, maxBytes: number) {
  if (!value || !/^\d+$/.test(value)) return false;
  const declaredBytes = Number(value);
  return Number.isSafeInteger(declaredBytes) && declaredBytes > maxBytes;
}

export async function readUtf8RequestBodyWithLimit(
  request: { body: ReadableStream<Uint8Array<ArrayBufferLike>> | null },
  maxBytes: number,
) {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("request body exceeds configured limit");
        throw new RequestBodyTooLargeError();
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return body;
}
