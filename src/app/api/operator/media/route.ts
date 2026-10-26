import path from "node:path";
import { requireOperator } from "@/lib/server/operator";
import { getPremiere } from "@/lib/festival/premiere";
import { getJob } from "@/lib/jobs/queue";
import { errorResponse, HttpError } from "@/lib/server/security";
import { serveMedia } from "@/lib/server/media";
import { sessionDirectory } from "@/lib/storage/session-storage";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireOperator(request); const entry = await getPremiere(new URL(request.url).searchParams.get("id") || "");
    if (entry.status === "revoked") throw new HttpError(410, "Permission revoked.");
    const job = await getJob(entry.jobId); if (job?.stage !== "completed") throw new HttpError(404, "Reel unavailable.");
    return await serveMedia(request, path.join(sessionDirectory(job.sessionId), `reel-${job.id}.mp4`), "video/mp4");
  } catch (error) { return errorResponse(error); }
}
