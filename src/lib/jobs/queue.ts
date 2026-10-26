import { access, copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { CreativeOptions } from "@/lib/creative/options";
import { probeVideo } from "@/lib/video/metadata";
import { createSessionId, ensureSession, readJobRecord, writeJobRecord } from "@/lib/storage/session-storage";
import { renderReel } from "@/lib/video/render";
import { dataRoot, limit, retentionMs } from "@/lib/server/config";
import { exclusive } from "@/lib/server/store";
import { HttpError } from "@/lib/server/security";
import { countSafely } from "@/lib/festival/metrics";
import { shotTranscripts } from "@/lib/transcription/clips";
import { executeEdl, loadClips } from "@/lib/video/render";
import type { EditDecisionList } from "@/lib/edit/edl";
import { sourceMediaPath } from "@/lib/sources/store";

export type JobStage = "queued" | "validating" | "preparing" | "rendering" | "finalizing" | "completed" | "failed";
export type ReelConsent = { publicDisplay: boolean; promoReuse: boolean };
export type JobMetrics = { queueWaitMs?: number; transcribeMs?: number; planMs?: number; renderDurationMs?: number; encodeMs?: number; verifyMs?: number; totalMs?: number; completedAt?: number; outputDurationSeconds?: number; outputBytes?: number; width?: number; height?: number };
/** A podcast highlight render: one validated EDL over imported sources, part of a three-reel batch. */
export type HighlightPayload = { importId: string; brollIds: string[]; edl: EditDecisionList; batchId: string; reelIndex: number };
export type ReelJob = { kind?: "clips" | "highlight"; highlight?: HighlightPayload; id: string; sessionId: string; presetId: string; title?: string; creative?: CreativeOptions; consent: ReelConsent; challengeId?: string; sourceId?: string; sourceJobId?: string; fingerprint?: string; stage: JobStage; error?: string; outputUrl?: string; coverUrl?: string; coverUrls?: string[]; metrics: JobMetrics; createdAt: number; expiresAt: number };
type Queue = { jobs: Map<string, ReelJob>; pending: string[]; running: number; ready?: Promise<void>; paused: boolean; draining: boolean };
const global = globalThis as typeof globalThis & { reelQueue?: Queue };
const queue: Queue = global.reelQueue ||= { jobs: new Map(), pending: [], running: 0, paused: false, draining: false };
export const isActive = (job: ReelJob) => !["failed", "completed"].includes(job.stage);
const workspace = (job: ReelJob) => path.join(dataRoot(), "sessions", job.sessionId, `work-${job.id}`);
/** Upload-time measurements travel with each immutable snapshot so renders never re-analyse footage. */
async function copyAnalyses(from: string, to: string) {
  await Promise.all([1, 2, 3].map((shot) => copyFile(path.join(from, `shot-${shot}-analysis.json`), path.join(to, `shot-${shot}-analysis.json`)).catch(() => undefined)));
}
async function save(job: ReelJob) { queue.jobs.set(job.id, job); await writeJobRecord(job); }
async function removePartial(job: ReelJob) {
  const directory = path.join(dataRoot(), "sessions", job.sessionId);
  await Promise.all([path.join(directory, `reel-${job.id}.mp4`), ...[1, 2, 3].map((i) => path.join(directory, `cover-reel-${job.id}-${i}.jpg`)), path.join(directory, `edl-reel-${job.id}.json`), workspace(job)].map((file) => rm(file, { force: true, recursive: true })));
}
export async function initializeQueue() {
  queue.ready ||= (async () => {
    const directory = path.join(dataRoot(), "jobs");
    await mkdir(directory, { recursive: true });
    for (const entry of await readdir(directory)) {
      if (!/^[a-f0-9-]{36}\.json$/i.test(entry)) continue;
      const job = await readJobRecord<ReelJob>(entry.slice(0, -5));
      if (!job) continue;
      if (isActive(job)) {
        job.stage = "failed"; job.error = "The server restarted during export. Your clips are preserved; retry this reel.";
        await removePartial(job); await save(job);
      } else if (job.expiresAt > Date.now()) queue.jobs.set(job.id, job);
    }
  })();
  await queue.ready;
}
async function runHighlight(job: ReelJob) {
  const payload = job.highlight!;
  const directory = path.join(dataRoot(), "sessions", job.sessionId);
  try {
    job.stage = "rendering"; job.metrics.queueWaitMs = Date.now() - job.createdAt; await save(job);
    const reelName = `reel-${job.id}.mp4`, started = Date.now();
    const sourcePaths = [sourceMediaPath(job.sessionId, payload.importId), ...payload.brollIds.map((id) => sourceMediaPath(job.sessionId, id))];
    await Promise.all(sourcePaths.map((file) => access(file)));
    const covers = await executeEdl(payload.edl, { sourcePaths, output: path.join(directory, reelName), workDirectory: workspace(job), coverPrefix: path.join(directory, `cover-reel-${job.id}`) });
    job.metrics.encodeMs = Date.now() - started;
    job.stage = "finalizing"; await save(job);
    const verifyStarted = Date.now();
    const [metadata, output] = await Promise.all([probeVideo(path.join(directory, reelName)), stat(path.join(directory, reelName))]);
    if (metadata.codecName !== "h264" || metadata.width !== payload.edl.canvas.width || metadata.height !== payload.edl.canvas.height || output.size < 1024) throw new Error("Invalid export");
    await writeFile(path.join(directory, `edl-reel-${job.id}.json`), JSON.stringify(payload.edl), "utf8");
    Object.assign(job.metrics, { verifyMs: Date.now() - verifyStarted, width: metadata.width, height: metadata.height, renderDurationMs: Date.now() - started, totalMs: Date.now() - job.createdAt, outputDurationSeconds: metadata.duration, outputBytes: output.size, completedAt: Date.now() });
    job.outputUrl = `/api/reels/${job.sessionId}/${reelName}`;
    job.coverUrls = covers.map((cover) => `/api/reels/${job.sessionId}/${path.basename(cover)}`);
    job.coverUrl = job.coverUrls[payload.edl.cover.selected];
    job.stage = "completed"; await save(job); countSafely("reels_completed");
  } catch (error) {
    console.error("Highlight render failed", { jobId: job.id, reason: error instanceof Error ? error.message.split(":")[0] : "unknown" });
    job.stage = "failed"; job.error = "This reel could not be rendered. The other reels and your source are unaffected; retry this one.";
    await removePartial(job); await save(job); countSafely("render_failures");
  } finally { await rm(workspace(job), { recursive: true, force: true }); }
}
async function run(job: ReelJob) {
  if (job.kind === "highlight") return runHighlight(job);
  try {
    job.stage = "validating"; job.metrics.queueWaitMs = Date.now() - job.createdAt; await save(job);
    await Promise.all([1, 2, 3].map((shot) => access(path.join(workspace(job), `shot-${shot}.mp4`))));
    job.stage = "preparing"; await save(job);
    const reelName = `reel-${job.id}.mp4`;
    const started = Date.now();
    // Speech captions transcribe the immutable snapshot once; regenerations of the same footage reuse it.
    let transcripts: Awaited<ReturnType<typeof shotTranscripts>>["words"] | undefined;
    const creative = job.creative!;
    if (creative.captionMode === "speech" && (creative.audioMode === "original" || creative.audioMode === "mix") && job.sourceId) {
      job.stage = "preparing"; await save(job);
      const transcribeStarted = Date.now();
      transcripts = (await shotTranscripts(path.join(dataRoot(), "sessions", job.sessionId, `sources-${job.sourceId}`), (await loadClips(workspace(job))).map((clip) => clip.hasAudio))).words;
      job.metrics.transcribeMs = Date.now() - transcribeStarted;
    }
    const rendered = await renderReel({ sessionId: job.sessionId, presetId: job.presetId, title: job.title, ...creative, transcripts, outputName: reelName, sourceDirectory: workspace(job), onStage: async (stage) => { job.stage = stage; await save(job); } });
    const verifyStarted = Date.now();
    const [metadata, output] = await Promise.all([probeVideo(rendered.output), stat(rendered.output)]);
    if (metadata.codecName !== "h264" || metadata.width !== rendered.edl.canvas.width || metadata.height !== rendered.edl.canvas.height || output.size < 1024) throw new Error("Invalid export");
    job.metrics.verifyMs = Date.now() - verifyStarted; job.metrics.planMs = rendered.timings.planMs; job.metrics.encodeMs = rendered.timings.renderMs;
    job.metrics.width = metadata.width; job.metrics.height = metadata.height;
    job.metrics.renderDurationMs = Date.now() - started; job.metrics.totalMs = Date.now() - job.createdAt;
    job.metrics.outputDurationSeconds = metadata.duration; job.metrics.outputBytes = output.size;
    job.stage = "finalizing"; await save(job);
    job.outputUrl = `/api/reels/${job.sessionId}/${reelName}`;
    job.coverUrls = rendered.covers.map((cover) => `/api/reels/${job.sessionId}/${path.basename(cover)}`);
    job.coverUrl = `/api/reels/${job.sessionId}/${path.basename(rendered.cover)}`; job.metrics.completedAt = Date.now(); job.stage = "completed"; await save(job); countSafely("reels_completed");
  } catch (error) {
    // Paths and raw FFmpeg diagnostics never enter visitor responses or public logs.
    console.error("Render failed", { jobId: job.id, stage: job.stage, reason: error instanceof Error ? error.message.split(":")[0] : "unknown", code: (error as NodeJS.ErrnoException).code, operation: (error as NodeJS.ErrnoException).syscall });
    job.stage = "failed"; job.error = "Export failed or timed out. Your original clips are saved. Please retry.";
    await removePartial(job); await save(job); countSafely("render_failures");
  } finally { await rm(workspace(job), { recursive: true, force: true }); }
}
function pump() {
  const maximum = limit("MAX_CONCURRENT_RENDERS", 1, 4);
  while (!queue.draining && queue.running < maximum && queue.pending.length) {
    const job = queue.jobs.get(queue.pending.shift()!)!;
    queue.running += 1;
    void run(job).catch(() => console.error("Could not persist render failure")).finally(() => { queue.running -= 1; pump(); });
  }
}
export function queueStats() { return { running: queue.running, pending: queue.pending.length, maxConcurrent: limit("MAX_CONCURRENT_RENDERS", 1, 4), maxPending: limit("MAX_PENDING_RENDERS", 8, 100), paused: queue.paused, draining: queue.draining }; }
export function pauseSubmissions(value: boolean) { queue.paused = value; }
export async function createJob(input: Omit<ReelJob, "id" | "stage" | "createdAt" | "expiresAt" | "metrics" | "fingerprint" | "creative"> & { creative: CreativeOptions }): Promise<ReelJob> {
  await initializeQueue();
  return exclusive("render-admission", () => exclusive(`session:${input.sessionId}`, async () => {
    const directory = await ensureSession(input.sessionId);
    let sourceId: string;
    let sourceDirectory: string;
    if (input.sourceJobId) {
      const original = queue.jobs.get(input.sourceJobId);
      if (!original || original.sessionId !== input.sessionId || original.stage !== "completed" || original.expiresAt <= Date.now()) throw new HttpError(404, "The original edit is unavailable in this session.");
      if (!original.sourceId) throw new HttpError(409, "This older edit has no source snapshot. Generate a new edit from your saved clips to use Remix Lab.");
      sourceId = original.sourceId; sourceDirectory = path.join(directory, `sources-${sourceId}`);
      await Promise.all([1, 2, 3].map((shot) => access(path.join(sourceDirectory, `shot-${shot}.mp4`))));
    } else {
      const stamps = await Promise.all([1, 2, 3].map(async (shot) => { const file = await stat(path.join(directory, `shot-${shot}.mp4`)); return [file.size, file.mtimeMs]; }));
      sourceId = createHash("sha256").update(JSON.stringify(stamps)).digest("hex");
      sourceDirectory = path.join(directory, `sources-${sourceId}`);
    }
    const fingerprint = JSON.stringify([input.presetId, input.title, input.creative, input.challengeId, sourceId]);
    const trimSource = input.sourceJobId ? sourceDirectory : directory;
    for (const [index, start] of input.creative.trimStarts.entries()) {
      if (start > 0 && start > Math.max(0, (await probeVideo(path.join(trimSource, `shot-${index + 1}.mp4`))).duration - 0.5)) throw new HttpError(400, `Shot ${index + 1} starts too late. Leave at least half a second of footage.`);
    }
    const duplicate = [...queue.jobs.values()].find((job) => job.sessionId === input.sessionId && job.kind !== "highlight" && job.fingerprint === fingerprint && job.stage !== "failed" && job.expiresAt > Date.now());
    if (duplicate) return duplicate;
    if ([...queue.jobs.values()].some((job) => job.sessionId === input.sessionId && job.kind !== "highlight" && isActive(job))) throw new HttpError(429, "Your session already has an export processing. Wait for it to finish before starting another edit.");
    if (queue.paused || queue.draining) throw new HttpError(503, "The studio is temporarily paused. Your shots are saved; please try again shortly.");
    if (queue.running >= limit("MAX_CONCURRENT_RENDERS", 1, 4) && queue.pending.length >= limit("MAX_PENDING_RENDERS", 8, 100)) throw new HttpError(429, "The render queue is full. Your shots are saved. Please retry shortly.");
    const createdAt = Date.now();
    const job: ReelJob = { ...input, sourceId, fingerprint, id: createSessionId(), stage: "queued", metrics: {}, createdAt, expiresAt: createdAt + retentionMs() };
    if (!input.sourceJobId) {
      await mkdir(sourceDirectory, { recursive: true });
      // Exclusive session admission makes this immutable snapshot atomic to renders and uploads.
      await Promise.all([1, 2, 3].map((shot) => copyFile(path.join(directory, `shot-${shot}.mp4`), path.join(sourceDirectory, `shot-${shot}.mp4`))));
      await copyAnalyses(directory, sourceDirectory);
    }
    await mkdir(workspace(job), { recursive: true });
    try { await Promise.all([1, 2, 3].map((shot) => copyFile(path.join(sourceDirectory, `shot-${shot}.mp4`), path.join(workspace(job), `shot-${shot}.mp4`)))); await copyAnalyses(sourceDirectory, workspace(job)); await save(job); }
    catch (error) { await rm(workspace(job), { recursive: true, force: true }); throw error; }
    queue.pending.push(job.id); pump(); return job;
  }));
}
/**
 * Queues one highlight reel. Identical edits are idempotent (the existing job is returned); a session may have at most
 * three highlight renders in flight, and the global render bound still applies.
 */
export async function createHighlightJob(input: { sessionId: string; payload: HighlightPayload; title: string }): Promise<ReelJob> {
  await initializeQueue();
  return exclusive("render-admission", () => exclusive(`session:${input.sessionId}`, async () => {
    const fingerprint = createHash("sha256").update(JSON.stringify([input.payload.importId, input.payload.brollIds, input.payload.edl])).digest("hex");
    const jobs = [...queue.jobs.values()];
    const duplicate = jobs.find((job) => job.sessionId === input.sessionId && job.kind === "highlight" && job.fingerprint === fingerprint && job.stage !== "failed" && job.expiresAt > Date.now());
    if (duplicate) return duplicate;
    if (jobs.filter((job) => job.sessionId === input.sessionId && job.kind === "highlight" && isActive(job)).length >= 3) throw new HttpError(429, "Three reels are already rendering for this session. Wait for one to finish.");
    if (queue.paused || queue.draining) throw new HttpError(503, "The studio is temporarily paused. Your source is saved; please try again shortly.");
    if (queue.pending.length >= limit("MAX_PENDING_RENDERS", 8, 100)) throw new HttpError(429, "The render queue is full. Please retry shortly.");
    const createdAt = Date.now();
    const job: ReelJob = { kind: "highlight", highlight: input.payload, id: createSessionId(), sessionId: input.sessionId, presetId: input.payload.edl.presetId, title: input.title, consent: { publicDisplay: false, promoReuse: false }, fingerprint, stage: "queued", metrics: {}, createdAt, expiresAt: createdAt + retentionMs() };
    await save(job);
    queue.pending.push(job.id); pump(); return job;
  }));
}
export async function getJob(id: string): Promise<ReelJob | undefined> {
  await initializeQueue();
  const job = queue.jobs.get(id);
  if (job && job.expiresAt <= Date.now() && !isActive(job)) queue.jobs.delete(id);
  return job && job.expiresAt > Date.now() ? job : undefined;
}
export async function listJobs() { await initializeQueue(); for (const [id, job] of queue.jobs) if (job.expiresAt <= Date.now() && !isActive(job)) queue.jobs.delete(id); return [...queue.jobs.values()].filter((job) => job.expiresAt > Date.now()).sort((a, b) => b.createdAt - a.createdAt); }
export function beginShutdown() { queue.draining = true; }
