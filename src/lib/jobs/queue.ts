import { access } from "node:fs/promises";
import path from "node:path";
import { createSessionId, ensureSession } from "@/lib/storage/session-storage";
import { renderReel } from "@/lib/video/render";

export type JobStage = "queued" | "validating" | "preparing" | "rendering" | "finalizing" | "completed" | "failed";
export type ReelJob = { id: string; sessionId: string; presetId: string; title?: string; stage: JobStage; error?: string; outputUrl?: string; coverUrl?: string; createdAt: number };
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
    await renderReel(job);
    job.stage = "finalizing";
    job.outputUrl = `/api/reels/${job.sessionId}/reel.mp4`;
    job.coverUrl = `/api/reels/${job.sessionId}/cover.jpg`;
    job.stage = "completed";
  } catch (error) {
    job.stage = "failed";
    job.error = error instanceof Error ? error.message.slice(0, 500) : "Rendering failed.";
  } finally {
    running = false;
    void pump();
  }
}

export function createJob(input: Omit<ReelJob, "id" | "stage" | "createdAt">): ReelJob {
  const duplicate = [...jobs.values()].find((job) => job.sessionId === input.sessionId && job.presetId === input.presetId && job.stage !== "failed");
  if (duplicate) return duplicate;
  const job: ReelJob = { ...input, id: createSessionId(), stage: "queued", createdAt: Date.now() };
  jobs.set(job.id, job); pending.push(job.id); void pump(); return job;
}
export const getJob = (id: string) => jobs.get(id);
