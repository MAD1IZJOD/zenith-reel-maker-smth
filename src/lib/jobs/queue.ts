import { access } from "node:fs/promises";
import path from "node:path";
import type { CreativeOptions } from "@/lib/creative/options";
import { probeVideo } from "@/lib/video/metadata";
import { stat } from "node:fs/promises";
import { createSessionId, ensureSession, readJobRecord, removeJobRecord, writeJobRecord } from "@/lib/storage/session-storage";
import { renderReel } from "@/lib/video/render";

export type JobStage = "queued" | "validating" | "preparing" | "rendering" | "finalizing" | "completed" | "failed";
export type ReelConsent = { publicDisplay: boolean; promoReuse: boolean };
export type JobMetrics = { queueWaitMs?: number; renderDurationMs?: number; completedAt?: number; outputDurationSeconds?: number; outputBytes?: number };
export type ReelJob = { id: string; sessionId: string; presetId: string; title?: string; creative: CreativeOptions; consent: ReelConsent; stage: JobStage; error?: string; outputUrl?: string; coverUrl?: string; coverUrls?: string[]; metrics: JobMetrics; createdAt: number; expiresAt: number };
const jobs = new Map<string, ReelJob>();
const pending: string[] = [];
let running = false;

async function save(job: ReelJob): Promise<void> { jobs.set(job.id, job); await writeJobRecord(job); }

async function pump(): Promise<void> {
  if (running) return;
  const id = pending.shift();
  if (!id) return;
  running = true;
  const job = jobs.get(id)!;
  try {
    job.stage = "validating";
    job.metrics.queueWaitMs = Date.now() - job.createdAt;
    await save(job);
    const directory = await ensureSession(job.sessionId);
    await Promise.all([1, 2, 3].map((shot) => access(path.join(directory, `shot-${shot}.mp4`))));
    job.stage = "preparing";
    await save(job);
    job.stage = "rendering";
    await save(job);
    const reelName = `reel-${job.id}.mp4`;
    const renderStartedAt = Date.now();
    const rendered = await renderReel({ sessionId: job.sessionId, presetId: job.presetId, title: job.title, ...job.creative, outputName: reelName });
    const [metadata, output] = await Promise.all([probeVideo(rendered.output), stat(rendered.output)]);
    job.metrics.renderDurationMs = Date.now() - renderStartedAt;
    job.metrics.outputDurationSeconds = metadata.duration;
    job.metrics.outputBytes = output.size;
    job.stage = "finalizing";
    await save(job);
    job.outputUrl = `/api/reels/${job.sessionId}/${reelName}`;
    job.coverUrls = rendered.covers.map((cover) => `/api/reels/${job.sessionId}/${path.basename(cover)}`);
    job.coverUrl = job.coverUrls[0];
    job.metrics.completedAt = Date.now();
    job.stage = "completed";
    await save(job);
  } catch (error) {
    job.stage = "failed";
    job.error = error instanceof Error ? error.message.slice(0, 500) : "Rendering failed.";
    await save(job);
  } finally {
    running = false;
    void pump();
  }
}

export async function createJob(input: Omit<ReelJob, "id" | "stage" | "createdAt" | "expiresAt" | "metrics">): Promise<ReelJob> {
  const duplicate = [...jobs.values()].find((job) => job.sessionId === input.sessionId && job.presetId === input.presetId && job.title === input.title && JSON.stringify(job.creative) === JSON.stringify(input.creative) && job.stage !== "failed");
  if (duplicate) return duplicate;
  const createdAt = Date.now();
  const job: ReelJob = { ...input, id: createSessionId(), stage: "queued", metrics: {}, createdAt, expiresAt: createdAt + Math.max(1, Number(process.env.RETENTION_HOURS || 24)) * 3_600_000 };
  await save(job); pending.push(job.id); void pump(); return job;
}
export const getJob = async (id: string): Promise<ReelJob | undefined> => {
  let job = jobs.get(id);
  if (!job) {
    try { job = await readJobRecord<ReelJob>(id); }
    catch { return undefined; }
  }
  if (job && job.expiresAt < Date.now()) { jobs.delete(id); await removeJobRecord(id); return undefined; }
  if (job && ["queued", "validating", "preparing", "rendering", "finalizing"].includes(job.stage) && !jobs.has(job.id)) {
    job.stage = "failed";
    job.error = "The server restarted while this reel was processing. Retry with the same three shots.";
    await save(job);
  }
  return job;
};
