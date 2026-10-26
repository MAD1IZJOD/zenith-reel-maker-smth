import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, rename, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sessionDirectory } from "@/lib/storage/session-storage";
import { readJson, writeJson, exclusive } from "@/lib/server/store";
import { limit } from "@/lib/server/config";
import { HttpError } from "@/lib/server/security";
import { ffmpeg, ffprobe, runProcess } from "@/lib/video/process";

export type SourceMedia = { duration: number; hasVideo: boolean; hasAudio: boolean; width?: number; height?: number; formatName: string; sizeBytes: number; contentHash?: string };
export type TranscriptState = { status: "none" | "queued" | "running" | "ready" | "failed"; engine?: "faster-whisper" | "import"; model?: string; language?: string; words?: number; segments?: number; wordTimestamps?: boolean; processingMs?: number; processedSeconds?: number; reusedFrom?: "same-content"; error?: string; updatedAt?: number };
export type SourceRecord = {
  id: string; sessionId: string; origin: "upload" | "url"; label: string; status: "ingesting" | "ready" | "failed"; error?: string;
  media?: SourceMedia; createdAt: number; rightsConfirmedAt: number; transcript: TranscriptState;
};

export const sourceLimits = () => ({ maxBytes: limit("MAX_SOURCE_MB", 1024, 4096) * 1048576, maxSeconds: limit("MAX_SOURCE_MINUTES", 90, 240) * 60, perSession: 5 });
const ID = /^[a-f0-9-]{36}$/i;
export const sourceRoot = (sessionId: string) => path.join(sessionDirectory(sessionId), "imports");
export function sourceDirectory(sessionId: string, id: string): string {
  if (!ID.test(id)) throw new HttpError(404, "Source not found.");
  return path.join(sourceRoot(sessionId), id);
}
export const sourceMediaPath = (sessionId: string, id: string) => path.join(sourceDirectory(sessionId, id), "original.media");

const active = (globalThis as typeof globalThis & { zenithIngests?: Set<string> }).zenithIngests ||= new Set<string>();
export const ingestsInFlight = () => active.size;

export async function readSource(sessionId: string, id: string): Promise<SourceRecord> {
  const record = await readJson<SourceRecord>(path.join(sourceDirectory(sessionId, id), "record.json"));
  if (!record || record.sessionId !== sessionId) throw new HttpError(404, "Source not found.");
  // Work interrupted by a restart is reported honestly rather than shown as still running.
  if (record.status === "ingesting" && !active.has(id)) return { ...record, status: "failed", error: "Import was interrupted. Please add the source again." };
  if ((record.transcript.status === "running" || record.transcript.status === "queued") && !active.has(`transcribe:${id}`)) return { ...record, transcript: { ...record.transcript, status: "failed", error: "Transcription was interrupted. Start it again." } };
  if (record.transcript.status === "running") {
    // The worker reports how far Whisper has actually progressed through the audio; nothing is estimated.
    const progress = await readJson<{ processed: number }>(path.join(sourceDirectory(sessionId, id), "transcribe-progress.json")).catch(() => undefined);
    if (progress && Number.isFinite(progress.processed)) return { ...record, transcript: { ...record.transcript, processedSeconds: Math.min(progress.processed, record.media?.duration ?? progress.processed) } };
  }
  return record;
}
export async function saveSource(record: SourceRecord): Promise<void> { await writeJson(path.join(sourceDirectory(record.sessionId, record.id), "record.json"), record); }
export async function listSources(sessionId: string): Promise<SourceRecord[]> {
  const entries = await readdir(sourceRoot(sessionId)).catch(() => [] as string[]);
  const records = await Promise.all(entries.filter((entry) => ID.test(entry)).map((entry) => readSource(sessionId, entry).catch(() => undefined)));
  return records.filter((record): record is SourceRecord => Boolean(record)).sort((a, b) => b.createdAt - a.createdAt);
}
export async function removeSource(sessionId: string, id: string): Promise<void> {
  if (active.has(id) || active.has(`transcribe:${id}`)) throw new HttpError(409, "This source is still being processed.");
  await rm(sourceDirectory(sessionId, id), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** Creates a record after rights confirmation and capacity checks. */
export async function createSource(sessionId: string, origin: SourceRecord["origin"], label: string, expectedBytes = 0): Promise<SourceRecord> {
  return exclusive(`sources:${sessionId}`, async () => {
    if ((await listSources(sessionId)).length >= sourceLimits().perSession) throw new HttpError(429, "This session already has five sources. Remove one to add another.");
    const id = randomUUID();
    await mkdir(sourceDirectory(sessionId, id), { recursive: true });
    const disk = await statfs(sourceRoot(sessionId));
    if (disk.bavail * disk.bsize < Math.max(1024 ** 3, expectedBytes * 3)) { await rm(sourceDirectory(sessionId, id), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); throw new HttpError(503, "Storage is nearly full. Please try a smaller file later."); }
    const record: SourceRecord = { id, sessionId, origin, label: label.replace(/[^\p{L}\p{N} ._()·-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Imported media", status: "ingesting", createdAt: Date.now(), rightsConfirmedAt: Date.now(), transcript: { status: "none" } };
    await saveSource(record);
    return record;
  });
}

/** Tracks long-running work so restarts and concurrent requests are reported correctly. */
export async function track<T>(key: string, task: () => Promise<T>): Promise<T> {
  active.add(key);
  try { return await task(); } finally { active.delete(key); }
}

/** Probes audio or video media; podcasts may be audio-only. */
export async function probeMedia(file: string): Promise<SourceMedia> {
  const output = JSON.parse(await runProcess(ffprobe(), ["-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type,width,height:stream_side_data=rotation", "-of", "json", file], "Source probe", 60_000)) as { format?: { duration?: string; format_name?: string }; streams?: { codec_type: string; width?: number; height?: number; side_data_list?: { rotation?: number }[] }[] };
  const video = output.streams?.find((entry) => entry.codec_type === "video" && entry.width && entry.height);
  const hasAudio = Boolean(output.streams?.some((entry) => entry.codec_type === "audio"));
  const duration = Number(output.format?.duration);
  const { maxSeconds } = sourceLimits();
  if (!video && !hasAudio) throw new HttpError(400, "This file has no playable audio or video.");
  if (!Number.isFinite(duration) || duration < 1) throw new HttpError(400, "The media duration could not be read.");
  if (duration > maxSeconds) throw new HttpError(400, `Sources can be up to ${Math.round(maxSeconds / 60)} minutes long.`);
  const rotated = Math.abs(video?.side_data_list?.find((data) => Number.isFinite(data.rotation))?.rotation || 0) % 180 === 90;
  return { duration, hasVideo: Boolean(video), hasAudio, width: video ? (rotated ? video.height : video.width) : undefined, height: video ? (rotated ? video.width : video.height) : undefined, formatName: output.format?.format_name || "unknown", sizeBytes: (await stat(file)).size };
}

/** Decodes short windows at the start, middle and end: corrupt or disguised files fail here, before any use. */
export async function validateDecode(file: string, duration: number): Promise<void> {
  for (const at of [0, Math.max(0, duration / 2 - 1), Math.max(0, duration - 2.5)]) {
    await runProcess(ffmpeg(), ["-v", "error", "-xerror", "-ss", at.toFixed(2), "-t", "2", "-i", file, "-f", "null", "-"], "Source decode check", 60_000)
      .catch(() => { throw new HttpError(400, "This media could not be decoded. Try exporting it again as MP4, MOV, WebM, MP3, M4A or WAV."); });
  }
}

const SUPPORTED_FORMATS = ["mov", "mp4", "m4a", "3gp", "3g2", "mj2", "webm", "matroska", "mp3", "wav", "ogg", "flac", "aac"];
/** Validates a downloaded or uploaded file and publishes it as the source's media. */
export async function finishIngest(record: SourceRecord, file: string): Promise<SourceRecord> {
  try {
    const media = await probeMedia(file);
    if (!media.formatName.split(",").some((format) => SUPPORTED_FORMATS.includes(format))) throw new HttpError(400, "This file is not a supported audio or video container.");
    await validateDecode(file, media.duration);
    media.contentHash = await hashFile(file);
    await rename(file, sourceMediaPath(record.sessionId, record.id));
    const ready: SourceRecord = { ...record, status: "ready", media, error: undefined };
    await saveSource(ready);
    return ready;
  } catch (error) {
    await rm(file, { force: true });
    const failed: SourceRecord = { ...record, status: "failed", error: error instanceof HttpError ? error.message : "Import failed. Please try another file." };
    await saveSource(failed);
    return failed;
  }
}

/** SHA-256 of the media bytes, used to reuse analysis when the same recording is imported again in a session. */
export async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
