import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { assertSessionId } from "@/lib/storage/session-storage";
import { errorResponse, HttpError, networkKey, rateLimit, requireSession } from "@/lib/server/security";
import { crossOriginReason } from "@/lib/server/origin";
import { createSource, finishIngest, ingestsInFlight, sourceDirectory, sourceLimits, track } from "@/lib/sources/store";
import { countSafely } from "@/lib/festival/metrics";
import { requirePodcastMode } from "@/lib/server/features";

export const runtime = "nodejs";
const MEDIA_TYPE = /^(video|audio)\/[a-z0-9.+-]+$/i;

/**
 * Raw-body streaming upload for long sources (podcasts, talks). The body goes straight to disk with a byte
 * limit, so memory use stays flat for multi-gigabyte files. Excluded from middleware; origin is checked here.
 */
export async function PUT(request: Request) {
  let target: string | undefined;
  try {
    await requirePodcastMode();
    const blocked = crossOriginReason(request.method, request.headers, new URL(request.url).origin);
    if (blocked) throw new HttpError(403, blocked);
    const params = new URL(request.url).searchParams;
    const sessionId = assertSessionId(params.get("sessionId") || "");
    await requireSession(request, sessionId);
    rateLimit(`source-upload:${networkKey(request)}`, 6);
    if (params.get("rights") !== "confirmed") throw new HttpError(400, "Confirm that you own this media or have permission to make clips from it.");
    const type = (request.headers.get("content-type") || "").split(";")[0].trim();
    if (!MEDIA_TYPE.test(type)) throw new HttpError(415, "Upload an audio or video file.");
    const { maxBytes } = sourceLimits();
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, `Sources can be up to ${Math.round(maxBytes / 1048576)} MB.`);
    if (!request.body) throw new HttpError(400, "No file was received.");
    if (ingestsInFlight() >= 2) throw new HttpError(429, "Other imports are running. Please try again in a minute.");
    const record = await createSource(sessionId, "upload", params.get("name") || "Uploaded media", Number.isFinite(declared) ? declared : 0);
    target = path.join(sourceDirectory(sessionId, record.id), "upload.part");
    const result = await track(record.id, async () => {
      try {
      let received = 0;
      const limitBytes = new Transform({ transform(chunk: Buffer, _encoding, callback) { received += chunk.length; callback(received > maxBytes ? new HttpError(413, `Sources can be up to ${Math.round(maxBytes / 1048576)} MB.`) : null, chunk); } });
      await pipeline(Readable.fromWeb(request.body as import("node:stream/web").ReadableStream), limitBytes, createWriteStream(target!, { mode: 0o600 }), { signal: AbortSignal.timeout(30 * 60_000) });
      if (received === 0) throw new HttpError(400, "No file was received.");
        return await finishIngest(record, target!);
      } catch (error) {
        // An incomplete transfer leaves nothing behind: the partial file and its record are removed.
        await rm(sourceDirectory(sessionId, record.id), { recursive: true, force: true });
        throw error;
      }
    });
    if (result.status === "ready") countSafely("source_imported");
    return NextResponse.json({ source: result }, { status: result.status === "ready" ? 200 : 400 });
  } catch (error) {
    if (target) await rm(target, { force: true });
    return errorResponse(error, "The upload did not complete. Please try again.");
  }
}
