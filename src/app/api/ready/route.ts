import { mkdir, statfs, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataRoot } from "@/lib/server/config";
import { ffmpeg, ffprobe, runProcess } from "@/lib/video/process";
import { initializeQueue, queueStats } from "@/lib/jobs/queue";
export const runtime = "nodejs";
export async function GET() {
  try {
    await initializeQueue(); await mkdir(dataRoot(), { recursive: true });
    const file = path.join(dataRoot(), `ready-${randomUUID()}.tmp`);
    await writeFile(file, "ready"); await rm(file);
    const disk = await statfs(dataRoot());
    if (disk.bavail * disk.bsize < 512 * 1024 * 1024) throw new Error("Low disk space");
    await Promise.all([runProcess(ffmpeg(), ["-version"], "FFmpeg", 10_000), runProcess(ffprobe(), ["-version"], "FFprobe", 10_000)]);
    if (queueStats().draining) throw new Error("Draining");
    return Response.json({ status: "ready" });
  } catch { return Response.json({ status: "unavailable" }, { status: 503 }); }
}
