import { rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { assertSessionId, cleanupExpiredSessions, ensureSession } from "@/lib/storage/session-storage";
import { probeVideo } from "@/lib/video/metadata";

export const runtime = "nodejs";
const supported = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-m4v", "video/3gpp"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const sessionId = assertSessionId(String(form.get("sessionId") || ""));
    const shot = Number(form.get("shot"));
    const file = form.get("file");
    const maxBytes = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 80)) * 1024 * 1024;
    if (!Number.isInteger(shot) || shot < 1 || shot > 3) throw new Error("Shot must be 1, 2, or 3.");
    if (!(file instanceof File)) throw new Error("Choose a video file.");
    if (!supported.has(file.type) || file.size === 0 || file.size > maxBytes) throw new Error(`Upload a supported video under ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    const directory = await ensureSession(sessionId);
    const temporary = path.join(directory, `incoming-${shot}-${randomUUID()}.video`);
    try {
      await writeFile(temporary, Buffer.from(await file.arrayBuffer()));
      const metadata = await probeVideo(temporary);
      const formats = metadata.formatName.split(",");
      if (!formats.some((format) => ["mov", "mp4", "webm", "matroska", "3gp", "3g2"].includes(format))) throw new Error("This file is not a supported MP4, WebM, MOV, or 3GP video.");
      const finalPath = path.join(directory, `shot-${shot}.mp4`);
      await rm(finalPath, { force: true });
      await rename(temporary, finalPath);
      void cleanupExpiredSessions();
      return NextResponse.json({ shot, metadata, previewUrl: `/api/reels/${sessionId}/shot-${shot}.mp4` });
    } finally { await rm(temporary, { force: true }); }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed." }, { status: 400 });
  }
}
