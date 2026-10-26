import "./isolated-data";
import assert from "node:assert/strict";
import { access, copyFile } from "node:fs/promises";
import path from "node:path";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { createSource, finishIngest, readSource, sourceDirectory, type SourceRecord } from "../src/lib/sources/store";
import { readTranscript, startTranscription } from "../src/lib/transcription/service";
import { transcriptWords } from "../src/lib/transcription/schema";
import { whisperConfig } from "../src/lib/transcription/faster-whisper";

/**
 * Real local transcription of real speech. Default fixture: Tears of Steel dialogue (CC-BY). Pass another fixture
 * name from data/fixtures, e.g. art_of_war_01-02_sun_tzu_64kb.mp3 (public domain), for long-form timing.
 */
export async function ingestFixture(sessionId: string, fixture: string): Promise<SourceRecord> {
  const created = await createSource(sessionId, "upload", path.basename(fixture));
  const part = path.join(sourceDirectory(sessionId, created.id), "upload.part");
  await copyFile(fixture, part);
  const source = await finishIngest(created, part);
  assert.equal(source.status, "ready", source.error);
  return source;
}

export async function transcribeAndWait(sessionId: string, id: string, language?: string) {
  const progress: number[] = [];
  await startTranscription(sessionId, id, language);
  let record = await readSource(sessionId, id);
  while (record.transcript.status === "queued" || record.transcript.status === "running") {
    if (record.transcript.processedSeconds !== undefined && progress.at(-1) !== record.transcript.processedSeconds) progress.push(record.transcript.processedSeconds);
    await new Promise((resolve) => setTimeout(resolve, 700)); record = await readSource(sessionId, id);
  }
  return { record, progress };
}

async function main() {
  const fixture = path.join(process.cwd(), "data", "fixtures", process.argv[2] || "tos-dialogue.mp4");
  await access(fixture).catch(() => { throw new Error("Run `npm run fixtures:fetch` first to download the fixtures."); });
  const sessionId = createSessionId(); await ensureSession(sessionId);
  const source = await ingestFixture(sessionId, fixture);
  const started = Date.now();
  const { record, progress } = await transcribeAndWait(sessionId, source.id, process.argv[3]);
  const wallMs = Date.now() - started;
  assert.equal(record.transcript.status, "ready", record.transcript.error);
  const transcript = (await readTranscript(sessionId, source.id))!;
  const words = transcriptWords(transcript);
  assert.ok(words.length > 20, "expected real speech");
  for (const [index, word] of words.entries()) { assert.ok(word.end >= word.start); if (index) assert.ok(word.start >= words[index - 1].start - 0.01, "words in order"); assert.ok(word.end <= transcript.duration + 0.5); }
  for (let index = 1; index < progress.length; index++) assert.ok(progress[index] >= progress[index - 1], "progress only moves forward");
  // Same request again, and the same bytes imported as a second source: both reuse the finished transcript.
  const reuseStarted = Date.now();
  assert.equal((await startTranscription(sessionId, source.id)).transcript.status, "ready");
  const twin = await ingestFixture(sessionId, fixture);
  const twinRecord = await startTranscription(sessionId, twin.id);
  assert.equal(twinRecord.transcript.status, "ready"); assert.equal(twinRecord.transcript.reusedFrom, "same-content");
  console.log(JSON.stringify({ fixture: path.basename(fixture), model: whisperConfig().model, mediaSeconds: source.media!.duration, transcriptionWallMs: wallMs, realTimeFactor: Number((wallMs / 1000 / source.media!.duration).toFixed(3)), progressSamples: progress.length, progressFirstLast: [progress[0], progress.at(-1)], reuseMs: Date.now() - reuseStarted, language: transcript.language, segments: transcript.segments.length, words: words.length, firstWords: words.slice(0, 10).map((word) => `${word.text}@${word.start.toFixed(2)}`) }, null, 2));
}
if (process.argv[1]?.includes("verify-transcription")) void main().then(() => process.exit(0), (error) => { console.error(error.message || error); process.exit(1); });
