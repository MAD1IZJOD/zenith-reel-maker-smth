import path from "node:path";
import { rm } from "node:fs/promises";
import { readJson, writeJson } from "@/lib/server/store";
import { HttpError } from "@/lib/server/security";
import { readSource, saveSource, sourceDirectory, sourceMediaPath, track, type SourceRecord } from "@/lib/sources/store";
import { extractSpeechAudio, transcribeWithWhisper, transcriptionAvailability, whisperConfig } from "./faster-whisper";
import { importTranscript, transcriptSchema, type Transcript } from "./schema";

export const transcriptPath = (sessionId: string, id: string) => path.join(sourceDirectory(sessionId, id), "transcript.json");

export async function readTranscript(sessionId: string, id: string): Promise<Transcript | undefined> {
  const value = await readJson<Transcript>(transcriptPath(sessionId, id));
  return value && transcriptSchema.safeParse(value).success ? value : undefined;
}

const summary = (transcript: Transcript, processingMs?: number): SourceRecord["transcript"] => ({
  status: "ready", engine: transcript.engine, model: transcript.model, language: transcript.language, segments: transcript.segments.length,
  words: transcript.segments.reduce((sum, segment) => sum + (segment.words?.length || 0), 0), wordTimestamps: transcript.wordTimestamps, processingMs, updatedAt: Date.now(),
});

// One transcription at a time: Whisper and an 8B model must not compete for the same laptop's memory and cores.
let chain: Promise<unknown> = Promise.resolve();
let waiting = 0;
export const transcriptionQueueLength = () => waiting;

/**
 * Starts (or reuses) a transcription. A transcript from the same model is reused, so later reels from the same
 * source never re-transcribe. Runs in the background; the source record reports progress and honest failures.
 */
export async function startTranscription(sessionId: string, id: string, language?: string): Promise<SourceRecord> {
  const record = await readSource(sessionId, id);
  if (record.status !== "ready" || !record.media) throw new HttpError(409, "The source is not ready yet.");
  if (!record.media.hasAudio) throw new HttpError(400, "This source has no audio track to transcribe.");
  if (record.transcript.status === "queued" || record.transcript.status === "running") return record;
  const existing = await readTranscript(sessionId, id);
  if (existing && existing.engine === "faster-whisper" && existing.model === whisperConfig().model) {
    const reused = { ...record, transcript: summary(existing, record.transcript.processingMs) };
    await saveSource(reused); return reused;
  }
  const available = await transcriptionAvailability();
  if (!available.available) throw new HttpError(503, available.reason || "Local transcription is unavailable.");
  if (waiting >= 3) throw new HttpError(429, "Several transcriptions are queued. Please try again shortly.");
  const queued: SourceRecord = { ...record, transcript: { status: "queued", engine: "faster-whisper", model: whisperConfig().model, updatedAt: Date.now() } };
  await saveSource(queued);
  waiting++;
  const media = record.media;
  void track(`transcribe:${id}`, () => {
    const run = chain.catch(() => undefined).then(async () => {
      waiting--;
      const started = Date.now();
      const audio = path.join(sourceDirectory(sessionId, id), "speech.wav");
      try {
        await saveSource({ ...queued, transcript: { ...queued.transcript, status: "running", updatedAt: Date.now() } });
        await extractSpeechAudio(sourceMediaPath(sessionId, id), audio, media.duration);
        const transcript = await transcribeWithWhisper(audio, transcriptPath(sessionId, id), media.duration, language);
        await saveSource({ ...queued, transcript: summary(transcript, Date.now() - started) });
      } catch (error) {
        console.error("Transcription failed", { source: id, reason: error instanceof Error ? error.message.split(":")[0] : "unknown" });
        await saveSource({ ...queued, transcript: { status: "failed", engine: "faster-whisper", model: queued.transcript.model, error: "Transcription failed. The source is unchanged; you can retry or import captions.", updatedAt: Date.now() } });
      } finally { await rm(audio, { force: true }); }
    });
    chain = run;
    return run;
  });
  return queued;
}

/** Stores a visitor-provided SRT/WebVTT/JSON transcript after strict validation. */
export async function saveImportedTranscript(sessionId: string, id: string, text: string): Promise<SourceRecord> {
  const record = await readSource(sessionId, id);
  if (record.status !== "ready" || !record.media) throw new HttpError(409, "The source is not ready yet.");
  if (record.transcript.status === "queued" || record.transcript.status === "running") throw new HttpError(409, "A transcription is already running for this source.");
  let transcript: Transcript;
  try { transcript = importTranscript(text, record.media.duration); } catch (error) { throw new HttpError(400, (error as Error).message); }
  await writeJson(transcriptPath(sessionId, id), transcript);
  const updated = { ...record, transcript: summary(transcript) };
  await saveSource(updated);
  return updated;
}
