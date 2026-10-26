import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sessionDirectory } from "@/lib/storage/session-storage";
import { exclusive, readJson, writeJson } from "@/lib/server/store";
import { HttpError } from "@/lib/server/security";
import { readSource, type SourceRecord } from "@/lib/sources/store";
import { readTranscript } from "@/lib/transcription/service";
import { transcriptWords, type Transcript } from "@/lib/transcription/schema";
import { highlightsFor, parsePreferences } from "@/lib/highlights/service";
import { keywords, snapInterval, type Preferences } from "@/lib/highlights/discover";
import { cleanOverlayText } from "@/lib/edit/edl";
import { planPodcastReel, VISUAL_STYLES } from "@/lib/edit/planner";
import { CAPTION_STYLES, EXPORT_PROFILES } from "@/lib/edit/styles";
import { createHighlightJob, getJob, type ReelJob } from "@/lib/jobs/queue";

/**
 * A podcast-to-reels batch: one analysed source, up to three highlights, one independent render job per reel.
 * Reels are edited, regenerated and retried individually; completed reels are never discarded by another's failure.
 */
export const styleSchema = z.object({
  visual: z.enum(VISUAL_STYLES).default("minimal"),
  captionStyle: z.enum(CAPTION_STYLES).default("clean-creator"),
  soundtrack: z.enum(["none", "pulse", "drift"]).default("none"),
  musicVolume: z.number().finite().min(0.05).max(0.4).default(0.16),
  profile: z.enum(EXPORT_PROFILES).default("fast"),
});
export type BatchStyle = z.infer<typeof styleSchema>;
const reelRequestSchema = z.object({
  candidateId: z.string().length(16).optional(),
  start: z.number().finite().min(0).optional(),
  end: z.number().finite().min(0).optional(),
  title: z.string().max(200).optional(),
  hook: z.string().max(200).optional(),
});
export type ReelRequest = z.infer<typeof reelRequestSchema>;

export type BatchReel = { index: number; candidateId?: string; start: number; end: number; title: string; hook: string; postCaption: string; hashtags: string[]; role: string; jobId: string; revision: number };
export type PodcastBatch = { id: string; sessionId: string; sourceId: string; preferences: Preferences; style: BatchStyle; brollIds: string[]; reels: BatchReel[]; createdAt: number; updatedAt: number };
export type ReelView = BatchReel & { status: ReelJob["stage"] | "expired"; error?: string; previewUrl?: string; downloadUrl?: string; coverUrl?: string; duration?: number; sizeBytes?: number; width?: number; height?: number; renderMs?: number };

const ID = /^[a-f0-9-]{36}$/i;
const batchPath = (sessionId: string, id: string) => { if (!ID.test(id)) throw new HttpError(404, "Batch not found."); return path.join(sessionDirectory(sessionId), "batches", `${id}.json`); };

export async function readBatch(sessionId: string, id: string): Promise<PodcastBatch> {
  const batch = await readJson<PodcastBatch>(batchPath(sessionId, id));
  if (!batch || batch.sessionId !== sessionId) throw new HttpError(404, "Batch not found.");
  return batch;
}

/** Validates b-roll: only this session's ready video sources, never the main source itself. */
async function brollSources(sessionId: string, sourceId: string, ids: unknown): Promise<SourceRecord[]> {
  const list = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && ID.test(id) && id !== sourceId).slice(0, 4) : [];
  const records = await Promise.all(list.map((id) => readSource(sessionId, id)));
  for (const record of records) if (record.status !== "ready" || !record.media?.hasVideo) throw new HttpError(400, "B-roll must be a ready video in this session.");
  return records;
}

type Resolved = Omit<BatchReel, "index" | "jobId" | "revision">;
/** On-screen text limit without cutting a word in half. */
function words(value: string, maximum: number): string {
  const clean = cleanOverlayText(value, 400);
  if (clean.length <= maximum) return clean;
  const cut = clean.slice(0, maximum - 1).replace(/\s+\S*$/, "");
  return `${cut || clean.slice(0, maximum - 1)}…`;
}
/** Resolves a reel request to a validated interval: a known candidate id, or visitor trims snapped to silence. */
async function resolveReel(request: ReelRequest, pool: Awaited<ReturnType<typeof highlightsFor>>["pool"], transcript: Transcript, previous?: BatchReel): Promise<Resolved> {
  const candidate = request.candidateId ? pool.find((item) => item.id === request.candidateId) : undefined;
  if (request.candidateId && !candidate) throw new HttpError(400, "That highlight is not available for this source.");
  const base = candidate || previous;
  let start = request.start ?? base?.start, end = request.end ?? base?.end;
  if (start === undefined || end === undefined) throw new HttpError(400, "Choose a highlight or a time range.");
  if (request.start !== undefined || request.end !== undefined) {
    try { ({ start, end } = snapInterval(transcript, start, end)); } catch (error) { throw new HttpError(400, (error as Error).message); }
  }
  const text = transcript.segments.filter((segment) => segment.end > start! && segment.start < end!).map((segment) => segment.text).join(" ");
  const fallbackHook = words(text.split(/[.?!]/)[0] || "Listen to this", 56);
  const hook = words(request.hook ?? (candidate?.hook || previous?.hook || fallbackHook), 60) || fallbackHook;
  const title = words(request.title ?? (candidate?.title || previous?.title || hook), 60) || hook;
  const hashtags = candidate?.hashtags || (base && Math.abs(base.start - start) < 0.5 && Math.abs(base.end - end) < 0.5 ? base.hashtags : keywords(text, 3).map((word) => `#${word.replace(/[^a-z0-9]/g, "")}`));
  return { candidateId: candidate?.id, start, end, title, hook, hashtags, role: candidate?.role || previous?.role || "highlight", postCaption: candidate?.postCaption || previous?.postCaption || `${title}\n\nExcerpt from the full recording. ${hashtags.join(" ")}` };
}

async function enqueue(batch: Pick<PodcastBatch, "sessionId" | "sourceId" | "style" | "brollIds">, reel: Resolved & { index: number }, batchId: string, source: SourceRecord, transcript: Transcript, broll: SourceRecord[]) {
  const media = source.media!;
  const edl = planPodcastReel({
    source: { duration: media.duration, width: media.width, height: media.height, hasVideo: media.hasVideo, hasAudio: media.hasAudio },
    start: reel.start, end: reel.end, words: transcriptWords(transcript), title: reel.title, hook: reel.hook,
    visual: batch.style.visual, captionStyle: batch.style.captionStyle, profile: batch.style.profile,
    music: batch.style.soundtrack === "none" ? undefined : { musicId: batch.style.soundtrack, gain: batch.style.musicVolume },
    broll: broll.map((clip) => ({ duration: clip.media!.duration, width: clip.media!.width, height: clip.media!.height, hasVideo: true, hasAudio: clip.media!.hasAudio })),
    keywords: reel.hashtags.map((tag) => tag.replace(/^#/, "")),
  });
  return createHighlightJob({ sessionId: batch.sessionId, title: reel.title, payload: { importId: batch.sourceId, brollIds: broll.map((clip) => clip.id), edl, batchId, reelIndex: reel.index } });
}

async function context(sessionId: string, sourceId: string) {
  const source = await readSource(sessionId, sourceId);
  const transcript = await readTranscript(sessionId, sourceId);
  if (source.status !== "ready" || !source.media || !transcript) throw new HttpError(409, "Transcribe this source before generating reels.");
  return { source, transcript };
}

export async function createBatch(sessionId: string, input: { sourceId?: unknown; preferences?: unknown; style?: unknown; reels?: unknown; brollIds?: unknown }): Promise<PodcastBatch> {
  if (typeof input.sourceId !== "string") throw new HttpError(400, "Choose a source.");
  const style = styleSchema.safeParse(input.style ?? {});
  if (!style.success) throw new HttpError(400, "Choose an available style.");
  const requests = z.array(reelRequestSchema).min(1).max(3).safeParse(input.reels);
  if (!requests.success) throw new HttpError(400, "Choose one to three highlights.");
  const preferences = parsePreferences(input.preferences);
  const { source, transcript } = await context(sessionId, input.sourceId);
  const broll = style.data.visual === "broll" ? await brollSources(sessionId, source.id, input.brollIds) : [];
  const discovery = await highlightsFor(sessionId, source.id, preferences);
  const resolved = await Promise.all(requests.data.map((request) => resolveReel(request, discovery.pool, transcript)));
  for (let a = 0; a < resolved.length; a++) for (let b = a + 1; b < resolved.length; b++) {
    const overlap = Math.min(resolved[a].end, resolved[b].end) - Math.max(resolved[a].start, resolved[b].start);
    if (overlap > 0.5) throw new HttpError(400, "Highlights overlap. Choose different moments for each reel.");
  }
  const id = randomUUID();
  const base = { sessionId, sourceId: source.id, style: style.data, brollIds: broll.map((clip) => clip.id) };
  const reels: BatchReel[] = [];
  // Reels are queued in order; each job is independent, so a failure never cancels the others.
  for (const [index, reel] of resolved.entries()) reels.push({ ...reel, index: index + 1, revision: 1, jobId: (await enqueue(base, { ...reel, index: index + 1 }, id, source, transcript, broll)).id });
  const batch: PodcastBatch = { id, ...base, preferences, reels, createdAt: Date.now(), updatedAt: Date.now() };
  await writeJson(batchPath(sessionId, id), batch);
  return batch;
}

/** Edits, regenerates or retries one reel; the other reels and their files are untouched. */
export async function updateReel(sessionId: string, batchId: string, index: number, request: unknown, styleChange?: unknown): Promise<PodcastBatch> {
  return exclusive(`batch:${batchId}`, async () => {
    const batch = await readBatch(sessionId, batchId);
    const position = batch.reels.findIndex((reel) => reel.index === index);
    if (position < 0) throw new HttpError(404, "Reel not found.");
    const parsed = reelRequestSchema.safeParse(request ?? {});
    if (!parsed.success) throw new HttpError(400, "Invalid reel changes.");
    const style = styleChange === undefined ? batch.style : styleSchema.safeParse({ ...batch.style, ...(styleChange as object) });
    if (styleChange !== undefined && !(style as { success: boolean }).success) throw new HttpError(400, "Choose an available style.");
    const nextStyle = styleChange === undefined ? batch.style : (style as { data: BatchStyle }).data;
    const { source, transcript } = await context(sessionId, batch.sourceId);
    const discovery = await highlightsFor(sessionId, batch.sourceId, batch.preferences);
    const reel = await resolveReel(parsed.data, discovery.pool, transcript, batch.reels[position]);
    for (const other of batch.reels) if (other.index !== index && Math.min(other.end, reel.end) - Math.max(other.start, reel.start) > 0.5) throw new HttpError(400, `This range overlaps reel ${other.index}.`);
    const broll = nextStyle.visual === "broll" ? await brollSources(sessionId, batch.sourceId, batch.brollIds) : [];
    const job = await enqueue({ ...batch, style: nextStyle }, { ...reel, index }, batch.id, source, transcript, broll);
    const previous = batch.reels[position];
    batch.reels[position] = { ...reel, index, jobId: job.id, revision: previous.jobId === job.id ? previous.revision : previous.revision + 1 };
    // A per-reel style change applies to this reel only; the batch default stays as chosen.
    batch.updatedAt = Date.now();
    await writeJson(batchPath(sessionId, batch.id), batch);
    return batch;
  });
}

export async function batchView(sessionId: string, batchId: string) {
  const batch = await readBatch(sessionId, batchId);
  const reels: ReelView[] = await Promise.all(batch.reels.map(async (reel) => {
    const job = await getJob(reel.jobId);
    if (!job || job.sessionId !== sessionId) return { ...reel, status: "expired" as const, error: "This reel expired with the session." };
    const ready = job.stage === "completed";
    const base = `/api/podcast/batches/${batch.id}/reels/${reel.index}?sessionId=${sessionId}&r=${reel.revision}`;
    return { ...reel, status: job.stage, error: job.error, previewUrl: ready ? base : undefined, downloadUrl: ready ? `${base}&download=1` : undefined, coverUrl: ready ? job.coverUrl : undefined, duration: job.metrics.outputDurationSeconds, sizeBytes: job.metrics.outputBytes, width: job.metrics.width, height: job.metrics.height, renderMs: job.metrics.renderDurationMs };
  }));
  return { ...batch, reels, completed: reels.filter((reel) => reel.status === "completed").length };
}

/** Absolute output path of a completed reel, resolved from the job record (never from visitor input). */
export async function reelFile(sessionId: string, batchId: string, index: number): Promise<string> {
  const batch = await readBatch(sessionId, batchId);
  const reel = batch.reels.find((item) => item.index === index);
  const job = reel ? await getJob(reel.jobId) : undefined;
  if (!reel || !job || job.sessionId !== sessionId || job.stage !== "completed") throw new HttpError(404, "This reel is not ready.");
  return path.join(sessionDirectory(sessionId), `reel-${job.id}.mp4`);
}
