import { access } from "node:fs/promises";
import path from "node:path";
import { createSessionId, ensureSession } from "@/lib/storage/session-storage";
import { renderReel } from "@/lib/video/render";

export type JobStage = "queued" | "validating" | "preparing" | "rendering" | "finalizing" | "completed" | "failed";
export type ReelJob = { id: string; sessionId: string; presetId: string; title?: string; stage: JobStage; error?: string; outputUrl?: string; coverUrl?: string; createdAt: number; expiresAt: number };
const jobs = new Map<string, ReelJob>();
const pending: string[] = [];
let running = false;

async function pump(): Promise<void> {
  if (running) return;
  const id = pending.shift();
  if (!id) return;
  running = true;
  const job = jobs.get(id)!;
  try {
    job.stage = "validating";
    const directory = await ensureSession(job.sessionId);
    await Promise.all([1, 2, 3].map((shot) => access(path.join(directory, `shot-${shot}.mp4`))));
    job.stage = "preparing";
    job.stage = "rendering";
    const reelName = `reel-${job.id}.mp4`;
    await renderReel({ ...job, outputName: reelName });
    job.stage = "finalizing";
    job.outputUrl = `/api/reels/${job.sessionId}/${reelName}`;
    job.coverUrl = `/api/reels/${job.sessionId}/cover-reel-${job.id}.jpg`;
    job.stage = "completed";
  } catch (error) {
    job.stage = "failed";
    job.error = error instanceof Error ? error.message.slice(0, 500) : "Rendering failed.";
  } finally {
    running = false;
    void pump();
  }
}

export function createJob(input: Omit<ReelJob, "id" | "stage" | "createdAt" | "expiresAt">): ReelJob {
  const duplicate = [...jobs.values()].find((job) => job.sessionId === input.sessionId && job.presetId === input.presetId && job.title === input.title && job.stage !== "failed");
  if (duplicate) return duplicate;
  const createdAt = Date.now();
  const job: ReelJob = { ...input, id: createSessionId(), stage: "queued", createdAt, expiresAt: createdAt + Math.max(1, Number(process.env.RETENTION_HOURS || 24)) * 3_600_000 };
  jobs.set(job.id, job); pending.push(job.id); void pump(); return job;
}
export const getJob = (id: string) => {
  const job = jobs.get(id);
  if (job && job.expiresAt < Date.now()) { jobs.delete(id); return undefined; }
  return job;
};
