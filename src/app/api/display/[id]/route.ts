import path from "node:path";
import { getPremiere, displaySettings } from "@/lib/festival/premiere";
import { getJob } from "@/lib/jobs/queue";
import { errorResponse, HttpError } from "@/lib/server/security";
import { sessionDirectory } from "@/lib/storage/session-storage";
import { serveMedia } from "@/lib/server/media";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const entry = await getPremiere((await context.params).id); const settings = await displaySettings();
    if (entry.status !== "approved" || settings.paused || settings.demoOnly) throw new HttpError(404, "Public screening unavailable.");
    const job = await getJob(entry.jobId); if (job?.stage !== "completed") throw new HttpError(404, "Reel unavailable.");
    return await serveMedia(request, path.join(sessionDirectory(job.sessionId), `reel-${job.id}.mp4`), "video/mp4");
  } catch (error) { return errorResponse(error); }
}
