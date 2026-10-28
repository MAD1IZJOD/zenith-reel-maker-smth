import { mkdir, statfs, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataRoot } from "@/lib/server/config";
import { cachedCheck, mediaHealthy } from "@/lib/server/health";
import { initializeQueue, queueStats } from "@/lib/jobs/queue";
export const runtime = "nodejs";
const storageReady = cachedCheck(async () => {
    await initializeQueue(); await mkdir(dataRoot(), { recursive: true });
    const file = path.join(dataRoot(), `ready-${randomUUID()}.tmp`);
    await writeFile(file, "ready"); await rm(file);
    const disk = await statfs(dataRoot());
    if (disk.bavail * disk.bsize < 512 * 1024 * 1024) throw new Error("Low disk space");
}, 5_000);
export async function GET() {
  try {
    if (queueStats().draining) throw new Error("Draining");
    if (!(await storageReady()) || !(await mediaHealthy())) throw new Error("Unavailable");
    return Response.json({ status: "ready" });
  } catch { return Response.json({ status: "unavailable" }, { status: 503 }); }
}
