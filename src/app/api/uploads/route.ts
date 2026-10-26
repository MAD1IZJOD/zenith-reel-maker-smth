import { rename, rm, writeFile, statfs } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { assertSessionId, ensureSession } from "@/lib/storage/session-storage";
import { probeVideo } from "@/lib/video/metadata";
import { createMezzanine } from "@/lib/video/mezzanine";
import { errorResponse, HttpError, networkKey, rateLimit, requireSession } from "@/lib/server/security";
import { exclusive, writeJson } from "@/lib/server/store";
import { analyzeShot } from "@/lib/video/shot-analysis";
import { limit } from "@/lib/server/config";
import { crossOriginReason } from "@/lib/server/origin";
import { countSafely } from "@/lib/festival/metrics";

export const runtime = "nodejs";
const supported = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-m4v", "video/3gpp"]);
const global = globalThis as typeof globalThis & { uploadsInFlight?: number };
export async function POST(request: Request) {
  let admitted = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // This route bypasses middleware (see src/middleware.ts), so it enforces the same-origin rule itself.
    const blocked = crossOriginReason(request.method, request.headers, new URL(request.url).origin);
    if (blocked) throw new HttpError(403, blocked);
    rateLimit(`upload:${networkKey(request)}`, 90);
    if ((global.uploadsInFlight || 0) >= limit("MAX_CONCURRENT_UPLOADS", 2, 8)) throw new HttpError(429, "The studio is receiving other clips. Keep this page open and retry shortly.");
    global.uploadsInFlight = (global.uploadsInFlight || 0) + 1; admitted = true;
    const maxBytes = limit("MAX_UPLOAD_MB", 80, 200) * 1024 * 1024;
    if (Number(request.headers.get("content-length")) > maxBytes + 65536) throw new HttpError(413, "This video is too large. Choose a shorter clip.");
    let received = 0;
    const bounded = request.body?.pipeThrough(new TransformStream({ start(controller) { timeout = setTimeout(() => controller.error(new HttpError(408, "Upload timed out. Reconnect and retry your saved clip.")), 120_000); }, transform(chunk, controller) { received += chunk.byteLength; if (received > maxBytes + 65536) throw new HttpError(413, "This video is too large."); controller.enqueue(chunk); } }));
    const form = await new Response(bounded, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    if (timeout) clearTimeout(timeout);
    const sessionId = assertSessionId(String(form.get("sessionId") || ""));
    await requireSession(request, sessionId);
    return await exclusive(`session:${sessionId}`, async () => {
      const shot = Number(form.get("shot")); const file = form.get("file");
      if (!Number.isInteger(shot) || shot < 1 || shot > 3) throw new HttpError(400, "Shot must be 1, 2, or 3.");
      if (!(file instanceof File)) throw new HttpError(400, "Choose a video file.");
      if (!supported.has(file.type.split(";")[0]) || !/\.(mp4|webm|mov|m4v|3gp)$/i.test(file.name) || file.size === 0 || file.size > maxBytes) throw new HttpError(400, `Upload an MP4, WebM, MOV, or 3GP video under ${maxBytes / 1048576} MB.`);
      const directory = await ensureSession(sessionId);
      const disk = await statfs(directory);
      if (disk.bavail * disk.bsize < Math.max(512 * 1024 * 1024, file.size * 4)) throw new HttpError(503, "Storage is nearly full. Please ask the stall team for help.");
      const temporary = path.join(directory, `incoming-${randomUUID()}.video`);
      const normalized = `${temporary}.mp4`;
      try {
        await writeFile(temporary, Buffer.from(await file.arrayBuffer()));
        // MediaRecorder WebM commonly omits duration until remuxed. The bounded decode below measures it.
        const mediaLimitError = () => new HttpError(400, `Choose a decodable video from 0.5 to ${limit("MAX_CLIP_DURATION", 90, 180)} seconds, no larger than 8K. Your other shots are saved.`);
        const metadata = await probeVideo(temporary, true).catch(() => { throw mediaLimitError(); });
        if (!metadata.formatName.split(",").some((format) => ["mov", "mp4", "webm", "matroska", "3gp", "3g2"].includes(format))) throw new HttpError(400, "This file is not a supported video container.");
        // Decode and normalize once into an editing mezzanine (see createMezzanine).
        await createMezzanine(temporary, normalized, limit("MAX_CLIP_DURATION", 90, 180) + 1);
        const outputMetadata = await probeVideo(normalized).catch(() => { throw mediaLimitError(); });
        // Measured on the normalized mezzanine: upright, constant frame rate and cheaper to decode than camera originals.
        const analysis = await analyzeShot(normalized, outputMetadata);
        await rename(normalized, path.join(directory, `shot-${shot}.mp4`));
        await writeJson(path.join(directory, `shot-${shot}-analysis.json`), analysis);
        countSafely("clip_saved");
        return NextResponse.json({ shot, metadata: outputMetadata, analysis, previewUrl: `/api/reels/${sessionId}/shot-${shot}.mp4?v=${randomUUID()}` });
      } finally { await Promise.all([temporary, normalized].map((file) => rm(file, { force: true }))); }
    });
  } catch (error) { return errorResponse(error, "This video could not be decoded. Try another clip, or record it again."); }
  finally { if (timeout) clearTimeout(timeout); if (admitted) global.uploadsInFlight = Math.max(0, (global.uploadsInFlight || 1) - 1); }
}
export async function DELETE(request: Request) {
  try {
    const blocked = crossOriginReason(request.method, request.headers, new URL(request.url).origin);
    if (blocked) throw new HttpError(403, blocked);
    const url = new URL(request.url); const sessionId = assertSessionId(url.searchParams.get("sessionId") || "");
    await requireSession(request, sessionId);
    const shot = Number(url.searchParams.get("shot"));
    if (!Number.isInteger(shot) || shot < 1 || shot > 3) throw new HttpError(400, "Shot must be 1, 2, or 3.");
    await exclusive(`session:${sessionId}`, async () => { const directory = await ensureSession(sessionId); await Promise.all([`shot-${shot}.mp4`, `shot-${shot}-analysis.json`].map((file) => rm(path.join(directory, file), { force: true }))); });
    return NextResponse.json({ cleared: true, shot });
  } catch (error) { return errorResponse(error, "Could not clear shot."); }
}
