import { HttpError } from "./security";

/** Bound bytes while reading, before JSON parsing or schema validation, including chunked requests. */
export async function readJsonBody(request: Request, maxBytes = 64 * 1024, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new HttpError(413, "Request body is too large.");
  if (!request.body) throw new HttpError(400, "A JSON object is required.");
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new HttpError(408, "Request body timed out.")), timeoutMs); });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new HttpError(413, "Request body is too large.");
      chunks.push(value);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")); }
    catch { throw new HttpError(400, "Invalid JSON body."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "A JSON object is required.");
    return parsed as Record<string, unknown>;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
