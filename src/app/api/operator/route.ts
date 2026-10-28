import { readJsonBody } from "@/lib/server/request-body";
import { statfs } from "node:fs/promises";
import { getJob, listJobs, pauseSubmissions, queueStats } from "@/lib/jobs/queue";
import { displaySettings, updatePremiere, type Premiere } from "@/lib/festival/premiere";
import { records } from "@/lib/festival/records";
import { dataRoot } from "@/lib/server/config";
import { recordPath, writeJson } from "@/lib/server/store";
import { requireOperator } from "@/lib/server/operator";
import { errorResponse, HttpError } from "@/lib/server/security";
import { todayMetrics } from "@/lib/festival/metrics";
import { mediaProcessStats } from "@/lib/video/process";
import { cleanupExpiredSessions } from "@/lib/storage/session-storage";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireOperator(request); const jobs = await listJobs(); const disk = await statfs(dataRoot());
    const submissions = [];
    for (const item of await records<Premiere>("premieres")) {
      const job = await getJob(item.jobId);
      if (item.expiresAt > Date.now() && job?.stage === "completed") submissions.push({ id: item.id, status: item.status, consentBasis: item.consentBasis, promoReuse: item.promoReuse, createdAt: item.createdAt, presetId: job.presetId, mediaUrl: `/api/operator/media?id=${item.id}` });
    }
    const durations = jobs.filter((job) => job.metrics.renderDurationMs).map((job) => job.metrics.renderDurationMs!);
    return Response.json({ queue: queueStats(), videoProcesses: mediaProcessStats(), diskFreeBytes: disk.bavail * disk.bsize, settings: await displaySettings(), daily: await todayMetrics(), jobs: jobs.slice(0, 40).map((job) => ({ id: job.id, presetId: job.presetId, stage: job.stage, error: job.error, createdAt: job.createdAt, renderMs: job.metrics.renderDurationMs })), submissions, metrics: { retainedJobs: jobs.length, completed: jobs.filter((job) => job.stage === "completed").length, failed: jobs.filter((job) => job.stage === "failed").length, meanRenderMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    requireOperator(request); const body = await readJsonBody(request);
    if (body.action === "review" && (body.status === "approved" || body.status === "rejected")) await updatePremiere(String(body.id), body.status);
    else if (body.action === "display" && typeof body.paused === "boolean" && typeof body.demoOnly === "boolean") await writeJson(recordPath("settings", "display"), { paused: body.paused, demoOnly: body.demoOnly });
    else if (body.action === "admission" && typeof body.paused === "boolean") pauseSubmissions(body.paused);
    else if (body.action === "cleanup") await cleanupExpiredSessions();
    else throw new HttpError(400, "Unknown operator action.");
    return Response.json({ updated: true });
  } catch (error) { return errorResponse(error); }
}
